import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MEMORY_CANDIDATE_KINDS } from './memory/memory-candidate';

import {
  DEFAULT_MITIGATION_POSTURE,
  MITIGATION_STRATEGIES,
} from './hallucination/hallucination-modes';
import type {
  MitigationPosture,
  MitigationStrategy,
} from './hallucination/hallucination-modes';

export const CORE_CONFIG = 'CORE_CONFIG';

export interface CoreConfig {
  port: number;
  /**
   * Interface to bind (S1). Default `127.0.0.1` — reachable only from
   * this machine. Set `0.0.0.0` (or a specific address) to expose it,
   * but read the boot warning first: ICOS has no authentication until
   * the security-hardening milestone lands.
   */
  host: string;
  /**
   * Browser origins allowed to call the API (S1). Explicit origins only
   * (`*` is refused); defaults to the bundled local dev client.
   */
  corsAllowedOrigins: string[];
  /**
   * Operator assertion that exposure is deliberate and protected
   * (TLS + auth in front). Silences the off-loopback boot warning only;
   * it changes no technical behavior.
   */
  exposeAcknowledged: boolean;
  /**
   * API authentication (S2). **On by default**: every route needs a
   * valid session except the explicit liveness/login allowlist. Set
   * false only for local throwaway use.
   */
  authEnabled: boolean;
  /** Directory holding the bootstrap token, session key, and audit log. */
  authDirPath: string;
  /** Session lifetime in ms (default 30 days). */
  authSessionTtlMs: number;
  /**
   * Send the session cookie with `Secure`. Requires HTTPS — keep true.
   * Set false ONLY for loopback/LAN HTTP development (the documented
   * exception); it downgrades transport protection.
   */
  authCookieSecure: boolean;
  /**
   * Encrypted secret vault path (S3). Defaults to
   * `<authDirPath>/secrets.vault` so it sits with the other secret
   * material and follows `AUTH_DIR_PATH` in Docker. Values written
   * through the API are encrypted here; the catalog only ever holds
   * references.
   */
  vaultPath?: string;
  /**
   * Master key for the vault: a 32-byte key as base64/base64url/hex,
   * read from a file (preferred; e.g. a Docker secret) or the
   * environment. Absent + empty vault = UI-managed secrets disabled;
   * absent + non-empty vault = boot fails loudly.
   */
  vaultKeyFile?: string;
  vaultKey?: string;
  /**
   * LLM provider catalog (S4). When present, entries here (selected via
   * its `active` map) replace the `LLM_*` / `MEMORY_LLM_*` env endpoint
   * values. Absent file = env-only behavior, exactly as before.
   */
  providersPath?: string;
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
   * M14 persona store: curated identity / user / relationship records,
   * staged candidates, and the drift log. A separate file from the
   * memory stores by design — identity is isolated from memory.
   * Optional in the type (tests and callers that never open it may omit
   * it); `loadConfig` always populates it.
   */
  personaDbPath?: string;
  /**
   * M16 channel store: the unified inbound/outbound message ledger and the
   * durable outbound delivery queue. A separate file, like persona —
   * channel traffic is its own subsystem. Optional on the type for callers
   * that never open it; `loadConfig` always populates it.
   */
  channelsDbPath?: string;
  /**
   * M16 outbound delivery: the queue drainer's cadence and retry policy.
   * Optional — the delivery service applies defaults when unset, so test
   * configs and callers that never send need not carry them.
   */
  channelDeliveryEnabled?: boolean;
  channelDeliveryIntervalMs?: number;
  channelDeliveryBatch?: number;
  channelDeliveryMaxAttempts?: number;
  channelDeliveryBackoffBaseMs?: number;
  channelDeliveryBackoffCapMs?: number;
  channelSendMinIntervalMs?: number;
  /**
   * M16 Discord channel: the bot token. Accepts a literal value or a secret
   * reference (`$VAR` / `secret:NAME`), resolved at connect time so a vault
   * rotation takes effect on reconnect. Optional — no token means the
   * channel is disabled (and it never blocks boot).
   */
  discordBotToken?: string;
  /**
   * M16 inbound Discord policy. A guild channel is a chat channel when its
   * topic contains `<discordStreamMarker> chat` (e.g. `[icos-stream: chat]`),
   * or when its id (or a thread's parent id) is in `discordAllowedChannelIds`.
   * Non-empty `discordAllowedUserIds` restricts who is answered; empty means
   * anyone in an accepted channel. DMs are answered only when allowed.
   */
  discordStreamMarker?: string;
  discordAllowedChannelIds?: string[];
  discordAllowedUserIds?: string[];
  discordAllowedGuildIds?: string[];
  discordAllowDirectMessages?: boolean;
  discordPresenceEnabled?: boolean;
  discordStatusChannelId?: string;
  discordPresenceOnline?: string;
  discordPresenceOffline?: string;
  /**
   * M16.1 email (Brevo transactional API). Outbound-only. The API key
   * resolves through the secret resolver (`$VAR` / `secret:NAME`), so it can
   * be set — never viewed — from the vault. A missing key or sender leaves the
   * channel disabled, never fatal.
   */
  brevoApiKey?: string;
  brevoSenderEmail?: string;
  brevoSenderName?: string;
  brevoApiBaseUrl?: string;
  /** Recipients the agent tool may email; empty disables agent-initiated email. */
  emailAllowedRecipients?: string[];
  /** Default subject for a channel send (email has no natural subject). */
  emailDefaultSubject?: string;
  /**
   * M16.2 web attachments. Uploaded files live under the data root
   * (host-absolute), are written owner-only, and are bounded by size and an
   * accepted MIME allow-list.
   */
  attachmentsDirPath?: string;
  attachmentsMaxBytes?: number;
  attachmentsAllowedMimeTypes?: string[];
  /**
   * M14b immutable core persona: a human-authored, read-only Markdown
   * file. ICOS has no write path to it. Optional on the type for the
   * same reason as `personaDbPath`; `loadConfig` always populates it.
   */
  personaCorePath?: string;
  /**
   * M14b fail-closed boot: when true (the default), a missing or invalid
   * core persona aborts startup rather than running half-grounded. Set
   * false only for dev/throwaway instances. Optional on the type for the
   * same reason as `personaDbPath`.
   */
  personaCoreRequired?: boolean;
  /**
   * M14c seed import root: the only directory persona seed imports may
   * read from (relative Markdown paths, realpath-confined). Optional on
   * the type; `loadConfig` always populates it.
   */
  personaSeedRoot?: string;
  /** M14d grounding bundle cap: max entries in the persona band. */
  personaGroundingEntryLimit?: number;
  /** M14d grounding bundle cap: approximate character budget for the band. */
  personaGroundingCharacterBudget?: number;
  /** M15b: relationship freshness window (hours) before it counts stale. */
  personaRelationshipFreshHours?: number;
  /** M15b: overall grounding score below this means "needs warm-up". */
  personaGroundingWarmupThreshold?: number;
  /** M15b: pending candidates in a similar cluster that count as pressure. */
  personaCandidatePressureCount?: number;
  /** M15b: lexical similarity that joins candidates into a pressure cluster. */
  personaCandidatePressureSimilarity?: number;
  /** M15c: semantic-drift signal at/above which a finding is raised. */
  personaSemanticDriftFloor?: number;
  /** M15c: semantic-drift signal at/above which severity is `critical`. */
  personaSemanticCriticalFloor?: number;
  /** M15d: consecutive elevated cycles that flag cumulative drift. */
  personaCumulativeMinCycles?: number;
  /**
   * M15.5c secondary-model verification. Tiers, preferred first:
   * - `hallucinationDecisionUrl` — a systemone decision model
   *   (`POST /v1/systemone`; local Jev or any Jev-compatible server);
   * - `hallucinationVerifierProvider` — a catalog provider id for an
   *   OpenAI-compatible LLM verifier;
   * - neither set → deterministic checks only.
   */
  hallucinationDecisionUrl?: string;
  hallucinationDecisionApiKeyRef?: string;
  hallucinationVerifierProvider?: string;
  hallucinationVerifierTimeoutMs?: number;
  /** M15.5d mitigation: strategy per severity (config-overridable). */
  hallucinationMitigationPosture?: Partial<MitigationPosture>;
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
   * M13 MCP kill-switch (default off — new capability, conservative).
   * False skips catalog loading entirely (explicit runs still work).
   */
  mcpEnabled: boolean;
  /** M13 catalog file for MCP servers (default ~/.icos/mcp-servers.json). */
  mcpServersPath: string;
  /** M13 per-call timeout in ms for MCP tool calls. */
  mcpTimeoutMs: number;
  /**
   * M13d reconnect backoff in ms. A failed server is retried in the
   * background at this cadence (unref'd — never blocks shutdown),
   * until it connects or the process stops. 0 disables auto-retry
   * (explicit `reconnect`/reload still work).
   */
  mcpReconnectBackoffMs: number;
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
   * Tool enablement (M17a). `enabledToolsets` is opt-in when non-empty;
   * `disabledToolsets` always wins; `enabledTools` re-enables a single tool
   * inside a disabled toolset. Empty everywhere = every tool offered.
   */
  toolsEnabledToolsets?: string[];
  toolsDisabledToolsets?: string[];
  toolsEnabled?: string[];
  toolsDisabled?: string[];
  /**
   * Filesystem root the file tools may read/search/write (M17b). A path that
   * resolves outside this root is refused. Default `~/.icos/workspace`.
   */
  toolsWorkspaceRoot?: string;
  /**
   * Realtime transport kill-switch. true (default) = attach `/core/events`
   * and deliver notifications; false = noop publisher, no socket, clients
   * fall back to polling. A transport fault must never take the UI down.
   */
  realtimeEnabled: boolean;
  /** Server heartbeat cadence in ms for socket liveness frames. */
  realtimeHeartbeatMs: number;
  /**
   * Socket origin allowlist (S1). Explicit origins only (`*` is
   * refused); falls back to `corsAllowedOrigins` when unset. A socket
   * with no Origin header is rejected unless the list is wildcard —
   * and wildcard is refused, so missing-origin clients are rejected.
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

/** Like parsePositiveInt but admits 0 (used for opt-out timers). */
function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (got "${raw}")`);
  }
  return value;
}

/** 0..1 score with a fallback; rejects NaN and out-of-range input. */
function parseMitigationStrategy(
  raw: string | undefined,
  fallback: MitigationStrategy,
): MitigationStrategy {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if ((MITIGATION_STRATEGIES as readonly string[]).includes(value)) {
    return value as MitigationStrategy;
  }
  throw new Error(
    `mitigation strategy must be one of ${MITIGATION_STRATEGIES.join(', ')} (got "${raw}")`,
  );
}

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

  // Parsed once; the realtime allowlist falls back to it when unset.
  const corsAllowedOrigins = parseOriginList(
    env.CORS_ALLOWED_ORIGINS,
    DEFAULT_ALLOWED_ORIGINS,
    'CORS_ALLOWED_ORIGINS',
  );
  const authDirPath = resolvePath(env.AUTH_DIR_PATH, '~/.icos/auth');

  return {
    port: parsePositiveInt(env.PORT, 3000, 'PORT'),
    host: (env.HOST ?? '').trim() || '127.0.0.1',
    corsAllowedOrigins,
    exposeAcknowledged: parseBoolean(env.EXPOSE_ACKNOWLEDGED, false),
    authEnabled: parseBoolean(env.AUTH_ENABLED, true),
    authDirPath,
    authSessionTtlMs: parsePositiveInt(
      env.AUTH_SESSION_TTL_MS,
      30 * 24 * 60 * 60 * 1000,
      'AUTH_SESSION_TTL_MS',
    ),
    authCookieSecure: parseBoolean(env.AUTH_COOKIE_SECURE, true),
    vaultPath:
      (env.VAULT_PATH ?? '').trim() || join(authDirPath, 'secrets.vault'),
    vaultKeyFile:
      (env.ICOS_VAULT_KEY_FILE ?? env.VAULT_KEY_FILE ?? '').trim() || undefined,
    vaultKey: (env.ICOS_VAULT_KEY ?? env.VAULT_KEY ?? '').trim() || undefined,
    providersPath: (env.PROVIDERS_PATH ?? '').trim() || undefined,
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
    personaDbPath: resolvePath(env.PERSONA_DB_PATH, '~/.icos/data/persona.db'),
    channelsDbPath: resolvePath(
      env.CHANNELS_DB_PATH,
      '~/.icos/data/channels.db',
    ),
    channelDeliveryEnabled: parseBoolean(env.CHANNEL_DELIVERY_ENABLED, true),
    channelDeliveryIntervalMs: parsePositiveInt(
      env.CHANNEL_DELIVERY_INTERVAL_MS,
      5000,
      'CHANNEL_DELIVERY_INTERVAL_MS',
    ),
    channelDeliveryBatch: parsePositiveInt(
      env.CHANNEL_DELIVERY_BATCH,
      10,
      'CHANNEL_DELIVERY_BATCH',
    ),
    channelDeliveryMaxAttempts: parsePositiveInt(
      env.CHANNEL_DELIVERY_MAX_ATTEMPTS,
      5,
      'CHANNEL_DELIVERY_MAX_ATTEMPTS',
    ),
    channelDeliveryBackoffBaseMs: parsePositiveInt(
      env.CHANNEL_DELIVERY_BACKOFF_BASE_MS,
      1000,
      'CHANNEL_DELIVERY_BACKOFF_BASE_MS',
    ),
    channelDeliveryBackoffCapMs: parsePositiveInt(
      env.CHANNEL_DELIVERY_BACKOFF_CAP_MS,
      30000,
      'CHANNEL_DELIVERY_BACKOFF_CAP_MS',
    ),
    channelSendMinIntervalMs: parsePositiveInt(
      env.CHANNEL_SEND_MIN_INTERVAL_MS,
      250,
      'CHANNEL_SEND_MIN_INTERVAL_MS',
    ),
    discordBotToken: (env.DISCORD_BOT_TOKEN ?? '').trim() || undefined,
    discordStreamMarker: (env.DISCORD_STREAM_MARKER ?? '').trim() || undefined,
    discordAllowedChannelIds: parseCsv(env.DISCORD_ALLOWED_CHANNEL_IDS),
    discordAllowedUserIds: parseCsv(env.DISCORD_ALLOWED_USER_IDS),
    discordAllowedGuildIds: parseCsv(env.DISCORD_ALLOWED_GUILD_IDS),
    discordAllowDirectMessages: parseBoolean(env.DISCORD_ALLOW_DMS, true),
    discordPresenceEnabled: parseBoolean(env.DISCORD_PRESENCE_ENABLED, true),
    discordStatusChannelId:
      (env.DISCORD_STATUS_CHANNEL_ID ?? '').trim() || undefined,
    discordPresenceOnline:
      (env.DISCORD_PRESENCE_ONLINE ?? '').trim() || undefined,
    discordPresenceOffline:
      (env.DISCORD_PRESENCE_OFFLINE ?? '').trim() || undefined,
    brevoApiKey: (env.BREVO_API_KEY ?? '').trim() || undefined,
    brevoSenderEmail: (env.BREVO_SENDER_EMAIL ?? '').trim() || undefined,
    brevoSenderName: (env.BREVO_SENDER_NAME ?? '').trim() || undefined,
    brevoApiBaseUrl:
      (env.BREVO_API_BASE_URL ?? '').trim() || 'https://api.brevo.com/v3',
    emailAllowedRecipients: parseCsv(env.EMAIL_ALLOWED_RECIPIENTS),
    emailDefaultSubject: (env.EMAIL_DEFAULT_SUBJECT ?? '').trim() || 'ICOS',
    attachmentsDirPath: resolvePath(
      env.ATTACHMENTS_DIR_PATH,
      '~/.icos/data/attachments',
    ),
    attachmentsMaxBytes: parsePositiveInt(
      env.ATTACHMENTS_MAX_BYTES,
      10 * 1024 * 1024,
      'ATTACHMENTS_MAX_BYTES',
    ),
    attachmentsAllowedMimeTypes: ((): string[] => {
      const configured = parseCsv(env.ATTACHMENTS_ALLOWED_MIME_TYPES);
      return configured.length > 0 ? configured : DEFAULT_ATTACHMENT_MIME_TYPES;
    })(),
    personaCorePath: resolvePath(
      env.PERSONA_CORE_PATH,
      '~/.icos/persona/core.md',
    ),
    personaCoreRequired: parseBoolean(env.PERSONA_CORE_REQUIRED, true),
    personaSeedRoot: resolvePath(env.PERSONA_SEED_ROOT, '~/.icos/seeds'),
    personaGroundingEntryLimit: parsePositiveInt(
      env.PERSONA_GROUNDING_ENTRY_LIMIT,
      12,
      'PERSONA_GROUNDING_ENTRY_LIMIT',
    ),
    personaGroundingCharacterBudget: parsePositiveInt(
      env.PERSONA_GROUNDING_CHARACTER_BUDGET,
      6000,
      'PERSONA_GROUNDING_CHARACTER_BUDGET',
    ),
    personaRelationshipFreshHours: parsePositiveInt(
      env.PERSONA_RELATIONSHIP_FRESH_HOURS,
      48,
      'PERSONA_RELATIONSHIP_FRESH_HOURS',
    ),
    personaGroundingWarmupThreshold: parseScore(
      env.PERSONA_GROUNDING_WARMUP_THRESHOLD,
      0.6,
      'PERSONA_GROUNDING_WARMUP_THRESHOLD',
    ),
    personaCandidatePressureCount: parsePositiveInt(
      env.PERSONA_CANDIDATE_PRESSURE_COUNT,
      3,
      'PERSONA_CANDIDATE_PRESSURE_COUNT',
    ),
    personaCandidatePressureSimilarity: parseScore(
      env.PERSONA_CANDIDATE_PRESSURE_SIMILARITY,
      0.6,
      'PERSONA_CANDIDATE_PRESSURE_SIMILARITY',
    ),
    personaSemanticDriftFloor: parseScore(
      env.PERSONA_SEMANTIC_DRIFT_FLOOR,
      0.2,
      'PERSONA_SEMANTIC_DRIFT_FLOOR',
    ),
    personaSemanticCriticalFloor: parseScore(
      env.PERSONA_SEMANTIC_CRITICAL_FLOOR,
      0.5,
      'PERSONA_SEMANTIC_CRITICAL_FLOOR',
    ),
    personaCumulativeMinCycles: parsePositiveInt(
      env.PERSONA_CUMULATIVE_MIN_CYCLES,
      3,
      'PERSONA_CUMULATIVE_MIN_CYCLES',
    ),
    hallucinationDecisionUrl:
      (env.HALLUCINATION_DECISION_URL ?? '').trim().replace(/\/+$/, '') ||
      undefined,
    hallucinationDecisionApiKeyRef:
      (env.HALLUCINATION_DECISION_API_KEY_REF ?? '').trim() || undefined,
    hallucinationVerifierProvider:
      (env.HALLUCINATION_VERIFIER_PROVIDER ?? '').trim() || undefined,
    hallucinationVerifierTimeoutMs: parsePositiveInt(
      env.HALLUCINATION_VERIFIER_TIMEOUT_MS,
      10000,
      'HALLUCINATION_VERIFIER_TIMEOUT_MS',
    ),
    hallucinationMitigationPosture: {
      info: parseMitigationStrategy(
        env.HALLUCINATION_MITIGATE_INFO,
        DEFAULT_MITIGATION_POSTURE.info,
      ),
      watch: parseMitigationStrategy(
        env.HALLUCINATION_MITIGATE_WATCH,
        DEFAULT_MITIGATION_POSTURE.watch,
      ),
      warning: parseMitigationStrategy(
        env.HALLUCINATION_MITIGATE_WARNING,
        DEFAULT_MITIGATION_POSTURE.warning,
      ),
      critical: parseMitigationStrategy(
        env.HALLUCINATION_MITIGATE_CRITICAL,
        DEFAULT_MITIGATION_POSTURE.critical,
      ),
    },
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
    mcpEnabled: parseBoolean(env.MCP_ENABLED, false),
    mcpServersPath: (env.MCP_SERVERS_PATH ?? '').trim() || '',
    mcpTimeoutMs: parsePositiveInt(env.MCP_TIMEOUT_MS, 30000, 'MCP_TIMEOUT_MS'),
    mcpReconnectBackoffMs: parseNonNegativeInt(
      env.MCP_RECONNECT_BACKOFF_MS,
      10000,
      'MCP_RECONNECT_BACKOFF_MS',
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
    toolsEnabledToolsets: parseCsv(env.TOOLS_ENABLED_TOOLSETS),
    toolsDisabledToolsets: parseCsv(env.TOOLS_DISABLED_TOOLSETS),
    toolsEnabled: parseCsv(env.TOOLS_ENABLED),
    toolsDisabled: parseCsv(env.TOOLS_DISABLED),
    toolsWorkspaceRoot: resolvePath(
      env.TOOLS_WORKSPACE_ROOT,
      '~/.icos/workspace',
    ),
    realtimeEnabled: parseBoolean(env.REALTIME_ENABLED, true),
    realtimeHeartbeatMs: parsePositiveInt(
      env.REALTIME_HEARTBEAT_MS,
      30_000,
      'REALTIME_HEARTBEAT_MS',
    ),
    realtimeAllowedOrigins: parseOriginList(
      env.REALTIME_ALLOWED_ORIGINS,
      corsAllowedOrigins,
      'REALTIME_ALLOWED_ORIGINS',
    ),
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
 * Comma-separated id list (channel/user ids). Empty/unset returns `[]`.
 * Trimmed and deduped; values are kept as-typed.
 */
/** Accepted upload MIME types when ATTACHMENTS_ALLOWED_MIME_TYPES is unset. */
const DEFAULT_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
];

function parseCsv(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    ),
  ];
}

/**
 * Default browser origins allowed in local development: the bundled
 * web client (`:4200`, loopback only). Anything else must be listed
 * explicitly — the API is not open to arbitrary origins.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
];

/**
 * Comma-separated origin allowlist. Empty/unset returns `fallback`.
 * Wildcards are refused outright: ICOS sends credentials-capable
 * responses and drives a live socket, and `*` would let any page the
 * operator visits call the API. Every entry must be a bare
 * `scheme://host[:port]` origin (no path, no trailing slash).
 */
function parseOriginList(
  raw: string | undefined,
  fallback: readonly string[],
  name: string,
): string[] {
  if (raw === undefined || raw.trim() === '') return [...fallback];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const origin = part.trim();
    if (origin === '') continue;
    if (origin === '*') {
      throw new Error(
        `${name} must list explicit origins; "*" is not allowed ` +
          `(wildcard access is unsafe). e.g. http://localhost:4200`,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`${name} entry "${origin}" is not a valid origin`);
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== origin
    ) {
      throw new Error(
        `${name} entry "${origin}" must be a bare origin ` +
          `(scheme://host[:port], no path or trailing slash)`,
      );
    }
    out.push(origin);
  }
  return [...new Set(out)];
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
