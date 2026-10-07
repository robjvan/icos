import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { buildRequestHeaders } from '../llm/llm-provider';
import type { LlmEndpointConfig } from '../llm/llm.client';
import { SecretResolver } from '../secrets/secret-resolver';
import { parseSecretReference } from '../secrets/reference';
import {
  loadProviderCatalog,
  readProviderRaw,
  removeProviderEntry,
  resolveProvidersPath,
  upsertProviderEntry,
  validateProviderEntry,
  writeProviderFile,
} from './provider-catalog';
import type {
  LoadedProviderCatalog,
  ProviderEntry,
  ProviderRole,
} from './provider-catalog';

/** Operator-visible provider entry (never the key). */
export interface ProviderStatus {
  id: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  /** True when the key reference resolves to a value right now. */
  hasKey: boolean;
}

export interface ProviderReport {
  /** Where the active endpoints come from. */
  source: 'catalog' | 'env';
  active: Record<ProviderRole, string>;
  providers: ProviderStatus[];
  errors: string[];
  path: string;
}

/** Map the LLM_* role configuration to endpoint values. */
export function conversationEndpointConfig(
  config: CoreConfig,
): LlmEndpointConfig {
  return {
    provider: config.provider,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
    llmApiKey: config.llmApiKey,
    headers: config.llmHeaders,
    userAgent: config.userAgent,
    llmTimeoutMs: config.llmTimeoutMs,
  };
}

/** Map the MEMORY_* role configuration to endpoint values. */
export function memoryEndpointConfig(config: CoreConfig): LlmEndpointConfig {
  return {
    provider: config.memoryProvider,
    llmBaseUrl: config.memoryLlmBaseUrl,
    llmModel: config.memoryLlmModel,
    llmApiKey: config.memoryLlmApiKey,
    headers: config.memoryLlmHeaders,
    userAgent: config.memoryUserAgent,
    llmTimeoutMs: config.memoryLlmTimeoutMs,
  };
}

/** Map the VISION_* role configuration to endpoint values (M17b.8). */
export function visionEndpointConfig(config: CoreConfig): LlmEndpointConfig {
  return {
    provider: config.visionProvider ?? config.memoryProvider,
    llmBaseUrl: config.visionLlmBaseUrl ?? config.memoryLlmBaseUrl,
    llmModel: config.visionLlmModel ?? config.memoryLlmModel,
    llmApiKey: config.visionLlmApiKey ?? config.memoryLlmApiKey,
    headers: config.visionLlmHeaders ?? config.memoryLlmHeaders,
    userAgent: config.visionUserAgent ?? config.memoryUserAgent,
    llmTimeoutMs: config.visionLlmTimeoutMs ?? config.memoryLlmTimeoutMs,
  };
}

/**
 * LLM provider registry (S4). Loads `providers.json` and resolves the
 * active conversation/memory endpoints **on demand** — so a reload, a
 * switched active provider, or a rotated vault key takes effect without
 * a restart. With no catalog (or no active entry) it falls back to the
 * env-configured endpoints, exactly as before. `apiKeyRef`/header
 * values are references resolved through the SecretStore; a value never
 * crosses this boundary outward.
 */
@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private catalog: LoadedProviderCatalog = {
    active: {},
    providers: [],
    errors: [],
    path: '',
  };

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly secrets: SecretResolver,
  ) {}

  onModuleInit(): void {
    this.reload();
  }

  /** Re-read the catalog without a restart; returns the new report. */
  reload(): ProviderReport {
    this.catalog = loadProviderCatalog(this.config.providersPath);
    for (const error of this.catalog.errors) {
      this.logger.warn(`Provider catalog: ${error}`);
    }
    if (this.catalog.path) {
      this.logger.log(
        `Provider catalog loaded (${this.catalog.providers.length} providers).`,
      );
    }
    return this.report();
  }

  /** Endpoint for the conversation role (active catalog entry or env). */
  conversationEndpoint(): LlmEndpointConfig {
    return this.endpointFor('conversation');
  }

  /** Endpoint for the memory/extraction role. */
  memoryEndpoint(): LlmEndpointConfig {
    return this.endpointFor('memory');
  }

  /**
   * Endpoint for the vision role (M17b.8). Env-only for now
   * (`VISION_LLM_*`, falling back to `MEMORY_LLM_*` then `LLM_*`); a
   * provider-catalog role is a follow-up.
   */
  visionEndpoint(): LlmEndpointConfig {
    return visionEndpointConfig(this.config);
  }

  /** Operator-visible status: names/models/presence, never values. */
  report(): ProviderReport {
    return {
      source: this.catalog.providers.length > 0 ? 'catalog' : 'env',
      active: {
        conversation: this.activeId('conversation'),
        memory: this.activeId('memory'),
      },
      providers: this.catalog.providers.map((entry) => ({
        id: entry.id,
        model: entry.model,
        baseUrl: entry.baseUrl,
        enabled: entry.enabled !== false,
        hasKey: entry.apiKeyRef
          ? this.secrets.resolve(entry.apiKeyRef) !== null
          : false,
      })),
      errors: this.catalog.errors,
      path: this.catalog.path,
    };
  }

  /** Set the active provider for a role and persist it to the catalog. */
  setActive(role: ProviderRole, id: string): ProviderReport {
    const entry = this.catalog.providers.find(
      (candidate) => candidate.id === id && candidate.enabled !== false,
    );
    if (!entry) {
      throw new Error(`unknown or disabled provider "${id}"`);
    }
    const path = resolveProvidersPath(this.config.providersPath);
    const raw = readProviderRaw(path);
    writeProviderFile(path, { ...raw.active, [role]: id }, raw.providers);
    return this.reload();
  }

  /** Catalog entries for the editor (references only, never values). */
  catalogEntries(): ProviderEntry[] {
    return this.catalog.providers;
  }

  /** Add or replace a provider, then reload (S5). Validated first. */
  upsertProvider(raw: unknown): ProviderReport {
    const result = validateProviderEntry(raw);
    if ('error' in result) throw new Error(result.error);
    const path = resolveProvidersPath(this.config.providersPath);
    const file = readProviderRaw(path);
    writeProviderFile(
      path,
      file.active,
      upsertProviderEntry(file.providers, result.entry),
    );
    return this.reload();
  }

  /** Remove a provider by id and drop it from `active` (S5). */
  removeProvider(id: string): ProviderReport {
    const path = resolveProvidersPath(this.config.providersPath);
    const file = readProviderRaw(path);
    const active = { ...file.active };
    for (const role of ['conversation', 'memory'] as const) {
      if (active[role] === id) delete active[role];
    }
    writeProviderFile(path, active, removeProviderEntry(file.providers, id));
    return this.reload();
  }

  /**
   * Probe one provider's endpoint (GET `<baseUrl>/models`). Uses the
   * resolved key transiently and never returns or stores it.
   */
  async testConnection(id: string): Promise<{ ok: boolean; detail: string }> {
    const entry = this.catalog.providers.find(
      (candidate) => candidate.id === id,
    );
    if (!entry) return { ok: false, detail: `unknown provider "${id}"` };
    const config = this.toEndpoint(entry, 'conversation');
    let url: string;
    try {
      const parsed = new URL(config.llmBaseUrl);
      const path = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = path.endsWith('/models') ? path : `${path}/models`;
      url = parsed.toString();
    } catch {
      return { ok: false, detail: 'baseUrl is not a URL' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildRequestHeaders(config),
        signal: controller.signal,
      });
      return response.ok
        ? { ok: true, detail: `HTTP ${response.status}` }
        : { ok: false, detail: `HTTP ${response.status}` };
    } catch {
      return { ok: false, detail: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Endpoint for a specific catalog provider id, or null when unknown or
   * disabled. No env fallback — callers use this to target a *named*
   * provider (e.g. an M15.5c verifier) and degrade when it is absent.
   */
  endpointForId(id: string): LlmEndpointConfig | null {
    const trimmed = id.trim();
    if (!trimmed) return null;
    const entry = this.catalog.providers.find(
      (candidate) => candidate.id === trimmed && candidate.enabled !== false,
    );
    return entry ? this.toEndpoint(entry, 'conversation') : null;
  }

  private activeId(role: ProviderRole): string {
    const id = this.catalog.active[role];
    const entry = id
      ? this.catalog.providers.find(
          (candidate) => candidate.id === id && candidate.enabled !== false,
        )
      : undefined;
    if (entry) return entry.id;
    return role === 'conversation'
      ? this.config.provider
      : this.config.memoryProvider;
  }

  private endpointFor(role: ProviderRole): LlmEndpointConfig {
    const id = this.catalog.active[role];
    const entry = id
      ? this.catalog.providers.find(
          (candidate) => candidate.id === id && candidate.enabled !== false,
        )
      : undefined;
    if (entry) return this.toEndpoint(entry, role);
    return role === 'conversation'
      ? conversationEndpointConfig(this.config)
      : memoryEndpointConfig(this.config);
  }

  private toEndpoint(
    entry: ProviderEntry,
    role: ProviderRole,
  ): LlmEndpointConfig {
    const defaultTimeout =
      role === 'conversation'
        ? this.config.llmTimeoutMs
        : this.config.memoryLlmTimeoutMs;
    return {
      provider: entry.id,
      llmBaseUrl: entry.baseUrl,
      llmModel: entry.model,
      ...(entry.apiKeyRef
        ? { llmApiKey: this.secrets.resolve(entry.apiKeyRef) ?? undefined }
        : {}),
      headers: this.resolveHeaders(entry),
      ...(entry.userAgent !== undefined ? { userAgent: entry.userAgent } : {}),
      llmTimeoutMs: entry.timeoutMs ?? defaultTimeout,
    };
  }

  /** Resolve header reference values; unresolved entries are dropped. */
  private resolveHeaders(
    entry: ProviderEntry,
  ): Record<string, string> | undefined {
    const resolved: Record<string, string> = {};
    for (const [key, reference] of Object.entries(entry.headers ?? {})) {
      if (!parseSecretReference(reference)) continue;
      const value = this.secrets.resolve(reference);
      if (value !== null) resolved[key] = value;
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  }
}
