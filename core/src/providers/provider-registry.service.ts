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
  /** Declared context window in tokens, when set. */
  contextWindow?: number;
  /** True when the key reference resolves to a value right now. */
  hasKey: boolean;
}

export interface ProviderReport {
  /** Where the active endpoints come from. */
  source: 'catalog' | 'env';
  active: Record<ProviderRole, string>;
  /** Per-role model override for the active provider (FG9c). */
  activeModel: Partial<Record<ProviderRole, string>>;
  providers: ProviderStatus[];
  errors: string[];
  path: string;
}

/** One model a provider advertises (FG9c). */
export interface ProviderModel {
  id: string;
  contextWindow?: number;
}

export interface ModelList {
  ok: boolean;
  detail: string;
  models: ProviderModel[];
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
    activeModel: {},
    providers: [],
    errors: [],
    path: '',
  };

  /** Listeners fired after each catalog reload (e.g. a model switch). */
  private readonly listeners = new Set<() => void>();

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
    this.notify();
    return this.report();
  }

  /** Register a change listener (fired after each catalog reload). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        this.logger.warn(
          `Provider change listener failed: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }
  }

  /**
   * The active catalog entry for a role, or null when the role falls back to
   * env-configured endpoints. Used by the context budget to read a declared
   * `contextWindow`.
   */
  activeEntry(role: ProviderRole): ProviderEntry | null {
    const id = this.catalog.active[role];
    if (!id) return null;
    const entry = this.catalog.providers.find(
      (candidate) => candidate.id === id && candidate.enabled !== false,
    );
    return entry ?? null;
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
      activeModel: {
        ...(this.catalog.activeModel.conversation
          ? { conversation: this.catalog.activeModel.conversation }
          : {}),
        ...(this.catalog.activeModel.memory
          ? { memory: this.catalog.activeModel.memory }
          : {}),
      },
      providers: this.catalog.providers.map((entry) => ({
        id: entry.id,
        model: entry.model,
        baseUrl: entry.baseUrl,
        enabled: entry.enabled !== false,
        ...(entry.contextWindow !== undefined
          ? { contextWindow: entry.contextWindow }
          : {}),
        hasKey: entry.apiKeyRef
          ? this.secrets.resolve(entry.apiKeyRef) !== null
          : false,
      })),
      errors: this.catalog.errors,
      path: this.catalog.path,
    };
  }

  /** Set the active provider for a role and persist it to the catalog. */
  setActive(role: ProviderRole, id: string, model?: string): ProviderReport {
    const entry = this.catalog.providers.find(
      (candidate) => candidate.id === id && candidate.enabled !== false,
    );
    if (!entry) {
      throw new Error(`unknown or disabled provider "${id}"`);
    }
    const path = resolveProvidersPath(this.config.providersPath);
    const raw = readProviderRaw(path);
    const activeModel = { ...raw.activeModel };
    if (model !== undefined && model.trim()) {
      activeModel[role] = model.trim();
    } else {
      delete activeModel[role];
    }
    writeProviderFile(
      path,
      { ...raw.active, [role]: id },
      raw.providers,
      activeModel,
    );
    return this.reload();
  }

  /** The active model override for a role, if any (FG9c). */
  activeModelFor(role: ProviderRole): string | undefined {
    return this.catalog.activeModel[role];
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
      file.activeModel,
    );
    return this.reload();
  }

  /** Remove a provider by id and drop it from `active` (S5). */
  removeProvider(id: string): ProviderReport {
    const path = resolveProvidersPath(this.config.providersPath);
    const file = readProviderRaw(path);
    const active = { ...file.active };
    const activeModel = { ...file.activeModel };
    for (const role of ['conversation', 'memory'] as const) {
      if (active[role] === id) {
        delete active[role];
        delete activeModel[role];
      }
    }
    writeProviderFile(
      path,
      active,
      removeProviderEntry(file.providers, id),
      activeModel,
    );
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
   * List the models a configured provider advertises (FG9c). Uses the
   * resolved key transiently; never returns or stores it.
   */
  async listModels(id: string): Promise<ModelList> {
    const entry = this.catalog.providers.find(
      (candidate) => candidate.id === id,
    );
    if (!entry) {
      return { ok: false, detail: `unknown provider "${id}"`, models: [] };
    }
    return this.fetchModels(this.toEndpoint(entry, 'conversation'));
  }

  /**
   * List the models an ad-hoc endpoint advertises, for the editor before a
   * provider is saved (FG9c). The key reference is resolved transiently.
   */
  async probeModels(baseUrl: string, apiKeyRef?: string): Promise<ModelList> {
    return this.fetchModels({
      provider: 'probe',
      llmBaseUrl: baseUrl,
      llmModel: '',
      ...(apiKeyRef
        ? { llmApiKey: this.secrets.resolve(apiKeyRef) ?? undefined }
        : {}),
      llmTimeoutMs: this.config.llmTimeoutMs,
    });
  }

  private async fetchModels(endpoint: LlmEndpointConfig): Promise<ModelList> {
    let url: string;
    try {
      const parsed = new URL(endpoint.llmBaseUrl);
      const path = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = path.endsWith('/models') ? path : `${path}/models`;
      url = parsed.toString();
    } catch {
      return { ok: false, detail: 'baseUrl is not a URL', models: [] };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), endpoint.llmTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: buildRequestHeaders(endpoint),
        signal: controller.signal,
      });
      if (!response.ok) {
        return { ok: false, detail: `HTTP ${response.status}`, models: [] };
      }
      const body = (await response.json()) as { data?: unknown };
      const data = Array.isArray(body.data) ? body.data : [];
      const models: ProviderModel[] = [];
      for (const item of data) {
        if (typeof item !== 'object' || item === null) continue;
        const record = item as Record<string, unknown>;
        if (typeof record['id'] !== 'string') continue;
        const raw = record['context_length'] ?? record['max_model_len'];
        const contextWindow =
          typeof raw === 'number' && raw > 0 ? raw : undefined;
        models.push({
          id: record['id'],
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        });
      }
      return { ok: true, detail: `HTTP ${response.status}`, models };
    } catch {
      return { ok: false, detail: 'unreachable', models: [] };
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
    if (entry) {
      return this.toEndpoint(entry, role, this.catalog.activeModel[role]);
    }
    return role === 'conversation'
      ? conversationEndpointConfig(this.config)
      : memoryEndpointConfig(this.config);
  }

  private toEndpoint(
    entry: ProviderEntry,
    role: ProviderRole,
    modelOverride?: string,
  ): LlmEndpointConfig {
    const defaultTimeout =
      role === 'conversation'
        ? this.config.llmTimeoutMs
        : this.config.memoryLlmTimeoutMs;
    return {
      provider: entry.id,
      llmBaseUrl: entry.baseUrl,
      llmModel: modelOverride ?? entry.model,
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
