import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import type { ChatMessage, LlmEndpointConfig } from '../llm/llm.client';

/** Rough characters-per-token heuristic (mirrors `memory/prompt-bands`). */
const CHARS_PER_TOKEN = 4;
/** Per-message framing overhead (role markers, separators). */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;
/** Probe timeout — best-effort, never blocks startup. */
const PROBE_TIMEOUT_MS = 3000;
/** Practical clamp on the compaction target. */
const MIN_TARGET = 0.5;
const MAX_TARGET = 0.95;

/**
 * Conservative fallback window (FG6), used only when the window cannot be
 * resolved from the provider catalog, `LLM_CONTEXT_WINDOW`, or a probe.
 * Deliberately small: a misconfiguration should over-compact (degraded) rather
 * than overrun the model's real window.
 */
export const DEFAULT_CONTEXT_WINDOW = 16_384;

/** Where the resolved window came from (surfaced to the operator). */
export type ContextWindowSource = 'provider' | 'env' | 'probe' | 'default';

/** Rough text → token estimate (len/4); never zero for non-empty text. */
export function estimateText(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export interface ContextSettings {
  contextWindow: number;
  contextWindowSource: ContextWindowSource;
  maxOutputTokens: number;
  usableTokens: number;
  triggerTokens: number;
  target: number;
  enabled: boolean;
}

/**
 * M20.6.1 context-budget accounting. Owns the resolved context window, the
 * usable budget (window − reserved output), and the compaction trigger.
 * Arithmetic + a documented heuristic — no LLM, no per-turn state. The window
 * is resolved from the configured model (FG6): provider catalog → env → probe
 * → conservative default, re-resolved when the active provider changes.
 */
@Injectable()
export class ContextBudgetService implements OnModuleInit {
  private readonly logger = new Logger(ContextBudgetService.name);
  private resolvedWindow = DEFAULT_CONTEXT_WINDOW;
  private windowSource: ContextWindowSource = 'default';
  private resolveToken = 0;
  private targetOverride: number | null = null;
  private enabledOverride: boolean | null = null;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly providers: ProviderRegistryService,
  ) {
    // Apply an explicit env window synchronously, so sync callers see it
    // before `onModuleInit` runs the full (provider/probe) resolution.
    if (config.llmContextWindow !== undefined) {
      this.resolvedWindow = config.llmContextWindow;
      this.windowSource = 'env';
    }
    this.loadOverrides();
  }

  /**
   * Resolve the window at boot, and again whenever the active provider
   * changes — so a model switch takes effect without a restart (FG6).
   */
  async onModuleInit(): Promise<void> {
    this.providers.onChange(() => {
      void this.resolveWindow();
    });
    await this.resolveWindow();
  }

  /**
   * Resolve the conversation window from the configured model, in order:
   * provider catalog → `LLM_CONTEXT_WINDOW` → provider probe → conservative
   * default. Never a silent stale default — an unresolved window warns (FG6).
   */
  async resolveWindow(): Promise<void> {
    // A model switch can fire this while an earlier probe is still in flight;
    // only the newest resolve may apply (otherwise a slow probe of the old
    // endpoint overwrites the new provider's declared window).
    const token = ++this.resolveToken;
    const entry = this.providers.activeEntry('conversation');
    let window: number | null = null;
    let source: ContextWindowSource = 'default';
    if (entry?.contextWindow !== undefined) {
      window = entry.contextWindow;
      source = 'provider';
    } else if (this.config.llmContextWindow !== undefined) {
      window = this.config.llmContextWindow;
      source = 'env';
    } else if (this.config.contextWindowAutodetect !== false) {
      window = await this.probeProviderWindow(
        this.providers.conversationEndpoint(),
      );
      if (window !== null) source = 'probe';
    }
    if (token !== this.resolveToken) return; // superseded by a newer resolve
    if (window === null) {
      this.logger.warn(
        `Context window unresolved: LLM_CONTEXT_WINDOW is unset, the active ` +
          `provider declares no contextWindow, and the provider probe found ` +
          `none. Using the conservative default of ${String(
            DEFAULT_CONTEXT_WINDOW,
          )} tokens — compaction will run more often than needed. Set ` +
          `LLM_CONTEXT_WINDOW (or a provider contextWindow) to the model's ` +
          `real window.`,
      );
      this.setWindow(DEFAULT_CONTEXT_WINDOW, 'default');
      return;
    }
    this.setWindow(window, source);
  }

  private setWindow(window: number, source: ContextWindowSource): void {
    const changed =
      window !== this.resolvedWindow || source !== this.windowSource;
    this.resolvedWindow = window;
    this.windowSource = source;
    if (changed) {
      this.logger.log(
        `Context window: ${String(window)} tokens (source: ${source})`,
      );
    }
  }

  get contextWindow(): number {
    return this.resolvedWindow;
  }

  get contextWindowSource(): ContextWindowSource {
    return this.windowSource;
  }

  get maxOutputTokens(): number {
    // Never let the reply reserve swallow the whole window (FG6): if the
    // resolved window is small, cap the reserve at half of it.
    return Math.min(
      this.config.llmMaxOutputTokens ?? 8192,
      Math.max(1, Math.floor(this.resolvedWindow / 2)),
    );
  }

  get enabled(): boolean {
    return (
      this.enabledOverride ?? this.config.contextCompactionEnabled !== false
    );
  }

  get target(): number {
    return this.targetOverride ?? this.config.contextCompactionTarget ?? 0.8;
  }

  /** Tokens available for the request after reserving the reply. */
  get usableTokens(): number {
    return Math.max(1, this.contextWindow - this.maxOutputTokens);
  }

  /** The estimate at which compaction triggers. */
  get triggerTokens(): number {
    return Math.floor(this.usableTokens * this.target);
  }

  /** The resolved budget for `/status` and the client. */
  settings(): ContextSettings {
    return {
      contextWindow: this.contextWindow,
      contextWindowSource: this.contextWindowSource,
      maxOutputTokens: this.maxOutputTokens,
      usableTokens: this.usableTokens,
      triggerTokens: this.triggerTokens,
      target: this.target,
      enabled: this.enabled,
    };
  }

  /** Persist a new compaction target (clamped). Returns the stored settings. */
  setTarget(value: number): ContextSettings {
    this.targetOverride = Math.min(
      MAX_TARGET,
      Math.max(MIN_TARGET, Number(value)),
    );
    this.persistOverrides();
    return this.settings();
  }

  /** Persist the compaction enabled flag. Returns the stored settings. */
  setEnabled(value: boolean): ContextSettings {
    this.enabledOverride = value;
    this.persistOverrides();
    return this.settings();
  }

  /** Heuristic token estimate for a message list (+ extra, e.g. tool schemas). */
  estimate(messages: readonly ChatMessage[], extraTokens = 0): number {
    let tokens = extraTokens;
    for (const message of messages) {
      tokens += estimateText(message.content) + PER_MESSAGE_OVERHEAD_TOKENS;
    }
    return tokens;
  }

  /** Whether an assembled context crosses the compaction trigger. */
  shouldCompact(messages: readonly ChatMessage[], extraTokens = 0): boolean {
    return (
      this.enabled && this.estimate(messages, extraTokens) > this.triggerTokens
    );
  }

  private settingsPath(): string | null {
    return this.config.contextSettingsPath ?? null;
  }

  private loadOverrides(): void {
    const path = this.settingsPath();
    if (!path) return;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        target?: unknown;
        enabled?: unknown;
      };
      if (typeof parsed.target === 'number') {
        this.targetOverride = Math.min(
          MAX_TARGET,
          Math.max(MIN_TARGET, parsed.target),
        );
      }
      if (typeof parsed.enabled === 'boolean') {
        this.enabledOverride = parsed.enabled;
      }
    } catch {
      // Missing/unreadable → config defaults stand.
    }
  }

  private persistOverrides(): void {
    const path = this.settingsPath();
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify(
          {
            target: this.targetOverride,
            enabled: this.enabledOverride,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      renameSync(tmp, path);
    } catch (err) {
      this.logger.warn(
        `Failed to persist context settings: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Best-effort window probe (FG6). Tries the OpenAI-compatible `/models`
   * (`context_length` / `max_model_len`) and, for an Ollama-style endpoint,
   * `/api/show` (`num_ctx` / `model_info.*.context_length`). Any failure is
   * silent — the caller falls back.
   */
  private async probeProviderWindow(
    endpoint: LlmEndpointConfig,
  ): Promise<number | null> {
    const base = (endpoint.llmBaseUrl ?? '').replace(/\/+$/, '');
    if (!base) return null;
    const headers: Record<string, string> = {};
    if (endpoint.llmApiKey) {
      headers['Authorization'] = `Bearer ${endpoint.llmApiKey}`;
    }
    const fromModels = await this.probeModels(base, endpoint.llmModel, headers);
    if (fromModels !== null) return fromModels;
    return this.probeOllamaShow(base, endpoint.llmModel, headers);
  }

  private async probeModels(
    base: string,
    model: string,
    headers: Record<string, string>,
  ): Promise<number | null> {
    const body = await this.getJson(`${base}/models`, { headers });
    if (!body || typeof body !== 'object') return null;
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) return null;
    const entry = (
      data as {
        id?: unknown;
        context_length?: unknown;
        max_model_len?: unknown;
      }[]
    ).find((candidate) => candidate.id === model);
    const value = entry?.context_length ?? entry?.max_model_len;
    return typeof value === 'number' && value > 0 ? value : null;
  }

  private async probeOllamaShow(
    base: string,
    model: string,
    headers: Record<string, string>,
  ): Promise<number | null> {
    // The Ollama API lives at the root, not under the OpenAI `/v1` prefix.
    const root = base.replace(/\/v1$/, '');
    const body = await this.getJson(`${root}/api/show`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, model }),
    });
    if (!body || typeof body !== 'object') return null;
    const record = body as { model_info?: unknown; parameters?: unknown };
    if (record.model_info && typeof record.model_info === 'object') {
      for (const [key, value] of Object.entries(
        record.model_info as Record<string, unknown>,
      )) {
        if (
          key.endsWith('.context_length') &&
          typeof value === 'number' &&
          value > 0
        ) {
          return value;
        }
      }
    }
    if (typeof record.parameters === 'string') {
      const match = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(record.parameters);
      if (match) {
        const value = Number(match[1]);
        if (value > 0) return value;
      }
    }
    return null;
  }

  private async getJson(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: init.method ?? 'GET',
        ...(init.headers ? { headers: init.headers } : {}),
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
