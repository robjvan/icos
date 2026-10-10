import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SecretResolver } from '../secrets/secret-resolver';
import type { ChatMessage } from '../llm/llm.client';

/** Rough characters-per-token heuristic (mirrors `memory/prompt-bands`). */
const CHARS_PER_TOKEN = 4;
/** Per-message framing overhead (role markers, separators). */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;
/** Probe timeout — best-effort, never blocks startup. */
const PROBE_TIMEOUT_MS = 3000;
/** Practical clamp on the compaction target. */
const MIN_TARGET = 0.5;
const MAX_TARGET = 0.95;

/** Rough text → token estimate (len/4); never zero for non-empty text. */
export function estimateText(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export interface ContextSettings {
  contextWindow: number;
  maxOutputTokens: number;
  usableTokens: number;
  triggerTokens: number;
  target: number;
  enabled: boolean;
}

/**
 * M20.6.1 context-budget accounting. Owns the resolved context window, the
 * usable budget (window − reserved output), and the compaction trigger.
 * Arithmetic + a documented heuristic — no LLM, no per-turn state. The
 * optional provider probe and the persisted target override are best-effort.
 */
@Injectable()
export class ContextBudgetService {
  private readonly logger = new Logger(ContextBudgetService.name);
  private resolvedWindow: number;
  private targetOverride: number | null = null;
  private enabledOverride: boolean | null = null;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    @Optional() private readonly secrets?: SecretResolver,
  ) {
    this.resolvedWindow = config.llmContextWindow ?? 1_000_000;
    this.loadOverrides();
  }

  /**
   * Best-effort context-window probe (M20.6.1). Off by default; when on and a
   * provider advertises a window (`context_length` / `max_model_len` on
   * `/models`), adopt it. Failure is silent — the configured value stands.
   */
  async onModuleInit(): Promise<void> {
    if (this.config.contextWindowAutodetect !== true) return;
    const detected = await this.probeProviderWindow();
    if (detected !== null && detected > 0) {
      this.resolvedWindow = detected;
      this.logger.log(`Adopted provider context window: ${detected} tokens`);
    }
  }

  get contextWindow(): number {
    return this.resolvedWindow;
  }

  get maxOutputTokens(): number {
    return this.config.llmMaxOutputTokens ?? 8192;
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

  private async probeProviderWindow(): Promise<number | null> {
    const base = (this.config.llmBaseUrl ?? '').replace(/\/+$/, '');
    if (!base) return null;
    const key = this.resolveKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        data?: {
          id?: string;
          context_length?: unknown;
          max_model_len?: unknown;
        }[];
      };
      const entry = (body.data ?? []).find(
        (model) => model.id === this.config.llmModel,
      );
      const value = entry?.context_length ?? entry?.max_model_len;
      return typeof value === 'number' && value > 0 ? value : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveKey(): string | null {
    const raw = this.config.llmApiKey;
    if (!raw) return null;
    return this.secrets?.resolve(raw) ?? raw;
  }
}
