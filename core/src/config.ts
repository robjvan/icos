import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MEMORY_CANDIDATE_KINDS } from './memory/memory-candidate';

export const CORE_CONFIG = 'CORE_CONFIG';

export interface CoreConfig {
  port: number;
  provider: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
  llmHeaders?: Record<string, string>;
  userAgent?: string;
  llmTimeoutMs: number;
  systemPrompt: string;
  maxHistory: number;
  sessionDbPath: string;
  memoryDbPath: string;
  /**
   * Pre-split single-file database, probed once as a migration source.
   * Explicit CORE_DB_PATH wins; otherwise the historical default
   * ./data/core.sqlite. Never written to; ignored when absent.
   */
  legacyDbPath: string;
  memoryExtractionEnabled: boolean;
  memoryProvider: string;
  memoryLlmBaseUrl: string;
  memoryLlmModel: string;
  memoryLlmApiKey?: string;
  memoryLlmHeaders?: Record<string, string>;
  memoryUserAgent?: string;
  memoryLlmTimeoutMs: number;
  /**
   * M10c promotion authority. false (default) = every promotion needs
   * a human approval; true admits NEW claims of the configured kinds
   * without approval. REINFORCE/CONTRADICT always require approval.
   */
  memoryPromotionAuto: boolean;
  /** Candidate kinds eligible for automatic promotion (default: none). */
  memoryPromotionAutoKinds: string[];
  /**
   * M11b confidence gate: claims below this engine confidence are
   * excluded from recall unless explicitly queried (or locked —
   * M12's certainty lock always admits). Familiar near-misses live
   * just above the cut only by rank, never by exemption.
   */
  memoryRecallConfidenceGate: number;
  /**
   * M11d interactive recall lens: claim origins hidden from
   * turn-time recall (default: none — the lens defaults off per
   * M11b). Agent chatter that would crowd out user signal goes
   * here. Unknown values fail startup loudly, like auto kinds.
   */
  memoryRecallExcludeOrigins: ('user' | 'agent')[];
  /** M11e memory-band token cap (chars/4 estimate). */
  memoryRecallMaxBandTokens: number;
  /** M11e turn-time recall latency budget in ms. */
  memoryRecallTimeoutMs: number;
  /**
   * M12 maintenance kill-switch (default on): false disables the
   * scheduled pass entirely (explicit runs still work). Async
   * aging must never surprise an operator.
   */
  memoryMaintenanceEnabled: boolean;
  /** M12 maintenance cadence in ms (default: hourly). */
  memoryMaintenanceIntervalMs: number;
  /**
   * M12c agent dampening: agent-origin claims compound at this
   * fraction of the normal step (default conservative 0.5), so the
   * agent's own statements never inflate by self-echo.
   */
  memoryAgentDampening: number;
  /**
   * M10e clarification trigger: a contradiction parks a prospective
   * item when the contradicted claim's confidence sits below this
   * (default 0.5). Repeat contests park regardless of confidence.
   */
  memoryProspectiveConfidenceThreshold: number;
  /** RuVector claim-index store path (M10d semantic surface). */
  vectorDbPath: string;
  /** Filesystem skill catalog root (M7). One `<name>/SKILL.md` per skill. */
  skillsDirPath: string;
  /** Kill-switch: false restores pre-M7 behavior exactly. */
  skillsEnabled: boolean;
  /** Per-skill body cap, applied after trimming. */
  skillsMaxBodyChars: number;
  /** Cap on catalog summaries injected into model context. */
  skillsMaxCatalogItems: number;
  /** Cap on explicitly session-pinned skills. */
  skillsMaxActivePerSession: number;
  /** Cap on automatically loaded skills per turn (provisional). */
  skillsMaxAutoLoadedPerTurn: number;
  /** Cap on total skill-body chars injected per turn (provisional). */
  skillsMaxContextChars: number;
  /** Max proposal rounds per turn (M9g execution budget). */
  agentMaxIterations: number;
  /** Max tool executions per turn (M9g execution budget). */
  agentMaxToolSteps: number;
  /** Backstop turn duration in ms (M9g execution budget). */
  agentMaxTurnDurationMs: number;
  /**
   * Realtime transport kill-switch. true (default) = attach `/core/events`
   * and deliver notifications; false = noop publisher, no socket, clients
   * fall back to polling. A transport fault must never take the UI down.
   */
  realtimeEnabled: boolean;
  /** Server heartbeat cadence in ms for socket liveness frames. */
  realtimeHeartbeatMs: number;
  /**
   * Socket origin allowlist. Default `*` in dev with the same posture as
   * the permissive CORS TODO in main.ts — restrict when frontends land.
   */
  realtimeAllowedOrigins: string[];
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

/** 0..1 score with a fallback; rejects NaN and out-of-range input. */
function parseScore(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1 (got "${raw}")`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const llmModel = (env.LLM_MODEL ?? '').trim();
  if (!llmModel) {
    throw new Error(
      'LLM_MODEL is required (e.g. LLM_MODEL=llama3.1). See .env.sample.',
    );
  }
  const llmBaseUrl = (env.LLM_BASE_URL ?? 'http://localhost:11434/v1')
    .trim()
    .replace(/\/+$/, '');

  return {
    port: parsePositiveInt(env.PORT, 3000, 'PORT'),
    provider: (env.LLM_PROVIDER ?? 'ollama').trim().toLowerCase() || 'ollama',
    llmBaseUrl,
    llmModel,
    llmApiKey: (env.LLM_API_KEY ?? '').trim() || undefined,
    llmHeaders: parseHeaders(env.LLM_HEADERS, 'LLM_HEADERS'),
    userAgent: (env.LLM_USER_AGENT ?? '').trim() || undefined,
    llmTimeoutMs: parsePositiveInt(env.LLM_TIMEOUT_MS, 60000, 'LLM_TIMEOUT_MS'),
    systemPrompt:
      (env.SYSTEM_PROMPT ?? 'You are Isabel, a helpful assistant.').trim() ||
      'You are Isabel, a helpful assistant.',
    maxHistory: parsePositiveInt(env.MAX_HISTORY, 50, 'MAX_HISTORY'),
    sessionDbPath: resolvePath(env.SESSION_DB_PATH, '~/.icos/data/sessions.db'),
    memoryDbPath: resolvePath(env.MEMORY_DB_PATH, '~/.icos/data/memories.db'),
    legacyDbPath: resolveLegacyDbPath(env.CORE_DB_PATH),
    memoryExtractionEnabled: parseBoolean(env.MEMORY_EXTRACTION_ENABLED, true),
    // Each falls back to its primary counterpart: the extraction role has
    // an explicit boundary (own client, own values) with zero-config default.
    memoryProvider:
      (env.MEMORY_PROVIDER ?? '').trim().toLowerCase() ||
      (env.LLM_PROVIDER ?? 'ollama').trim().toLowerCase() ||
      'ollama',
    memoryLlmBaseUrl: (env.MEMORY_LLM_BASE_URL ?? llmBaseUrl)
      .trim()
      .replace(/\/+$/, ''),
    memoryLlmModel: (env.MEMORY_LLM_MODEL ?? '').trim() || llmModel,
    memoryLlmApiKey:
      (env.MEMORY_LLM_API_KEY ?? env.LLM_API_KEY ?? '').trim() || undefined,
    memoryLlmHeaders: parseHeaders(
      env.MEMORY_LLM_HEADERS ?? env.LLM_HEADERS,
      'MEMORY_LLM_HEADERS',
    ),
    memoryUserAgent:
      (env.MEMORY_USER_AGENT ?? env.LLM_USER_AGENT ?? '').trim() || undefined,
    memoryLlmTimeoutMs: parsePositiveInt(
      env.MEMORY_LLM_TIMEOUT_MS,
      60000,
      'MEMORY_LLM_TIMEOUT_MS',
    ),
    memoryPromotionAuto: parseBoolean(env.MEMORY_PROMOTION_AUTO, false),
    memoryPromotionAutoKinds: parseKindList(env.MEMORY_PROMOTION_AUTO_KINDS),
    memoryProspectiveConfidenceThreshold: parseScore(
      env.MEMORY_PROSPECTIVE_CONFIDENCE_THRESHOLD,
      0.5,
      'MEMORY_PROSPECTIVE_CONFIDENCE_THRESHOLD',
    ),
    memoryRecallConfidenceGate: parseScore(
      env.MEMORY_RECALL_CONFIDENCE_GATE,
      0.3,
      'MEMORY_RECALL_CONFIDENCE_GATE',
    ),
    memoryRecallExcludeOrigins: parseRecallExcludeOrigins(
      env.MEMORY_RECALL_EXCLUDE_ORIGINS,
    ),
    memoryRecallMaxBandTokens: parsePositiveInt(
      env.MEMORY_RECALL_MAX_BAND_TOKENS,
      800,
      'MEMORY_RECALL_MAX_BAND_TOKENS',
    ),
    memoryRecallTimeoutMs: parsePositiveInt(
      env.MEMORY_RECALL_TIMEOUT_MS,
      5000,
      'MEMORY_RECALL_TIMEOUT_MS',
    ),
    memoryMaintenanceEnabled: parseBoolean(
      env.MEMORY_MAINTENANCE_ENABLED,
      true,
    ),
    memoryMaintenanceIntervalMs: parsePositiveInt(
      env.MEMORY_MAINTENANCE_INTERVAL_MS,
      3600000,
      'MEMORY_MAINTENANCE_INTERVAL_MS',
    ),
    memoryAgentDampening: parseScore(
      env.MEMORY_AGENT_DAMPENING,
      0.5,
      'MEMORY_AGENT_DAMPENING',
    ),
    vectorDbPath: resolvePath(
      env.VECTOR_DB_PATH,
      '~/.icos/data/claims-vector.db',
    ),
    skillsDirPath: resolvePath(env.SKILLS_DIR_PATH, '~/.icos/skills'),
    skillsEnabled: parseBoolean(env.SKILLS_ENABLED, true),
    skillsMaxBodyChars: parsePositiveInt(
      env.SKILLS_MAX_BODY_CHARS,
      12000,
      'SKILLS_MAX_BODY_CHARS',
    ),
    skillsMaxCatalogItems: parsePositiveInt(
      env.SKILLS_MAX_CATALOG_ITEMS,
      50,
      'SKILLS_MAX_CATALOG_ITEMS',
    ),
    skillsMaxActivePerSession: parsePositiveInt(
      env.SKILLS_MAX_ACTIVE_PER_SESSION,
      5,
      'SKILLS_MAX_ACTIVE_PER_SESSION',
    ),
    skillsMaxAutoLoadedPerTurn: parsePositiveInt(
      env.SKILLS_MAX_AUTO_LOADED_PER_TURN,
      2,
      'SKILLS_MAX_AUTO_LOADED_PER_TURN',
    ),
    skillsMaxContextChars: parsePositiveInt(
      env.SKILLS_MAX_CONTEXT_CHARS,
      8000,
      'SKILLS_MAX_CONTEXT_CHARS',
    ),
    agentMaxIterations: parsePositiveInt(
      env.AGENT_MAX_ITERATIONS,
      5,
      'AGENT_MAX_ITERATIONS',
    ),
    agentMaxToolSteps: parsePositiveInt(
      env.AGENT_MAX_TOOL_STEPS,
      5,
      'AGENT_MAX_TOOL_STEPS',
    ),
    agentMaxTurnDurationMs: parsePositiveInt(
      env.AGENT_MAX_TURN_DURATION_MS,
      15 * 60 * 1000,
      'AGENT_MAX_TURN_DURATION_MS',
    ),
    realtimeEnabled: parseBoolean(env.REALTIME_ENABLED, true),
    realtimeHeartbeatMs: parsePositiveInt(
      env.REALTIME_HEARTBEAT_MS,
      30_000,
      'REALTIME_HEARTBEAT_MS',
    ),
    realtimeAllowedOrigins: parseOriginList(env.REALTIME_ALLOWED_ORIGINS),
  };
}

/**
 * Comma-separated claim-origin lens, e.g. "agent". Empty/unset hides
 * nothing. Unknown values throw — a typo must not silently narrow
 * or widen recall.
 */
function parseRecallExcludeOrigins(
  raw: string | undefined,
): ('user' | 'agent')[] {
  if (raw === undefined || raw.trim() === '') return [];
  const origins = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  for (const origin of origins) {
    if (origin !== 'user' && origin !== 'agent') {
      throw new Error(
        `MEMORY_RECALL_EXCLUDE_ORIGINS contains unknown origin "${origin}"`,
      );
    }
  }
  return [...new Set(origins)] as ('user' | 'agent')[];
}

/**
 * Comma-separated candidate-kind allowlist, e.g. "fact,observation".
 * Empty/unset admits nothing. Unknown kinds throw — a typo must not
 * silently widen automatic promotion.
 */
function parseKindList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const kinds = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  const known = new Set(MEMORY_CANDIDATE_KINDS as readonly string[]);
  for (const kind of kinds) {
    if (!known.has(kind)) {
      throw new Error(
        `MEMORY_PROMOTION_AUTO_KINDS contains unknown kind "${kind}"`,
      );
    }
  }
  return [...new Set(kinds)];
}

/**
 * Comma-separated origin allowlist, e.g. "http://localhost:4200". Empty
 * or unset means `*` (dev default, same posture as the permissive CORS
 * TODO — restrict when real frontends land).
 */
function parseOriginList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return ['*'];
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    ),
  ];
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes') return true;
  if (value === 'false' || value === '0' || value === 'no') return false;
  throw new Error(`Expected a boolean (got "${raw}")`);
}

/**
 * Arbitrary static headers from a JSON object string, e.g.
 * `{"HTTP-Referer": "https://example.com", "X-Title": "My App"}`.
 * Keys/values must be non-empty strings.
 */
function parseHeaders(
  raw: string | undefined,
  name: string,
): Record<string, string> | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${name} must be a JSON object of string values`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object of string values`);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim() || typeof value !== 'string' || !value.trim()) {
      throw new Error(`${name} must be a JSON object of string values`);
    }
    headers[key.trim()] = value.trim();
  }
  return headers;
}

function resolvePath(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim() || fallback;
  if (value === '~') return homedir();
  const expanded = value.startsWith('~/')
    ? join(homedir(), value.slice(2))
    : value;
  return resolve(process.cwd(), expanded);
}

function resolveLegacyDbPath(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value) return resolvePath(value, value);
  return resolve(process.cwd(), './data/core.sqlite');
}

export const coreConfigProvider = {
  provide: CORE_CONFIG,
  useFactory: (): CoreConfig => loadConfig(),
};
