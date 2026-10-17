import type { CoreConfig } from '../config';
import type { SessionStore } from '../conversation/session.store';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type { HostHealth, HostHealthProvider } from '../commands/host-health';

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unknown';

export interface HealthCheck {
  status: HealthCheckStatus;
  detail: string;
}

export interface LlmHealthCheck extends HealthCheck {
  provider: string;
  model: string;
  /** Present when the endpoint was probed (FG9b). */
  reachable?: boolean;
}

/** Per-server MCP state as surfaced by health (never secrets). */
export interface McpServerHealth {
  name: string;
  transport: string;
  state: string;
  reason?: string;
  toolCount: number;
}

/** MCP roll-up in the health surface (M13d). */
export interface McpHealth {
  status: HealthCheckStatus;
  detail: string;
  enabled: boolean;
  servers: McpServerHealth[];
}

/** What health needs from the MCP manager (structural, no coupling). */
export interface McpHealthSource {
  statusAll(): readonly McpServerHealth[];
}

/** Active LLM provider state (S4) — never a key. */
export interface ProviderHealth {
  source: 'catalog' | 'env';
  active: { conversation: string; memory: string };
  providers: {
    id: string;
    model: string;
    enabled: boolean;
    hasKey: boolean;
    /** Present when the provider was probed (FG9b). */
    reachable?: boolean;
  }[];
  /** Active-endpoint reachability per role (FG9b). */
  reachability?: {
    conversation?: ProviderReachability;
    memory?: ProviderReachability;
  };
}

/** A probed LLM endpoint's reachability (FG9b). Never a key. */
export interface ProviderReachability {
  ok: boolean;
  detail: string;
  checkedAt: string;
  provider: string;
  model: string;
  baseUrl: string;
}

export interface ProviderHealthSource {
  report(): ProviderHealth;
  /** Optional: cached active-endpoint reachability per role (FG9b). */
  reachability?(role: 'conversation' | 'memory'): Promise<ProviderReachability>;
  /** Optional: cached per-provider reachability (FG9b). */
  providerReachability?(id: string): Promise<ProviderReachability | null>;
}

/**
 * Pollable health payload. Same shape as the `/health` slash-command
 * `data` — one model serves both the conversation API and `GET /core/health`.
 */
export interface HealthReport {
  status: 'healthy' | 'degraded';
  runtime: {
    core: HealthCheck;
    sessions: HealthCheck;
    memory: HealthCheck;
    llm: LlmHealthCheck;
  };
  /** Present only when the MCP manager is wired into the health surface. */
  mcp?: McpHealth;
  /** Present only when the provider registry is wired. */
  providers?: ProviderHealth;
  host: HostHealth;
}

export interface HealthReportDeps {
  sessions: SessionStore;
  candidates: MemoryCandidateRepository;
  config: CoreConfig;
  host: HostHealthProvider;
  /** Optional: absent for callers without the MCP manager (slash command). */
  mcp?: McpHealthSource;
  /** Optional: absent for callers without the provider registry. */
  providers?: ProviderHealthSource;
}

/**
 * Single source of truth for health data. Shared by the `/health`
 * slash command and the `GET /core/health` endpoint so the two can
 * never drift apart.
 */
export async function buildHealthReport(
  deps: HealthReportDeps,
): Promise<HealthReport> {
  const { sessions, candidates, config, host } = deps;
  const core: HealthCheck = {
    status: 'healthy',
    detail: `uptime ${Math.floor(process.uptime())}s`,
  };
  let sessionsCheck: HealthCheck;
  try {
    await sessions.pingStores();
    sessionsCheck = { status: 'healthy', detail: 'sessions database ok' };
  } catch (err) {
    sessionsCheck = {
      status: 'degraded',
      detail: err instanceof Error ? err.message : 'unreachable',
    };
  }
  let memory: HealthCheck;
  try {
    await candidates.ping();
    memory = { status: 'healthy', detail: 'memory database ok' };
  } catch (err) {
    memory = {
      status: 'degraded',
      detail: err instanceof Error ? err.message : 'unreachable',
    };
  }
  // FG9b: probe the active endpoint so a misconfigured provider
  // (host.docker.internal-class) fails visibly instead of reading `unknown`.
  const probe = config.providerReachabilityEnabled !== false;
  const llmReachability =
    probe && deps.providers?.reachability
      ? await deps.providers.reachability('conversation')
      : null;
  const llmConfigured = Boolean(config.llmBaseUrl && config.llmModel);
  const llm: LlmHealthCheck = !llmConfigured
    ? {
        status: 'degraded',
        detail: 'LLM provider not configured',
        provider: config.provider,
        model: config.llmModel,
      }
    : llmReachability
      ? {
          status: llmReachability.ok ? 'healthy' : 'degraded',
          detail: `${llmReachability.provider}/${llmReachability.model}: ${llmReachability.detail}`,
          provider: llmReachability.provider,
          model: llmReachability.model,
          reachable: llmReachability.ok,
        }
      : {
          status: 'unknown',
          detail: `configured (provider=${config.provider}, model=${config.llmModel}); reachability not probed`,
          provider: config.provider,
          model: config.llmModel,
        };

  const hostHealth = await host.collect();
  const status =
    sessionsCheck.status === 'degraded' ||
    memory.status === 'degraded' ||
    llm.status === 'degraded'
      ? 'degraded'
      : 'healthy';

  return {
    status,
    runtime: {
      core,
      sessions: sessionsCheck,
      memory,
      llm,
    },
    ...(deps.mcp
      ? { mcp: buildMcpHealth(config.mcpEnabled, deps.mcp.statusAll()) }
      : {}),
    ...(deps.providers
      ? { providers: await buildProviderHealth(deps.providers, probe) }
      : {}),
    host: hostHealth,
  };
}

/** Active LLM provider state (S4): ids/models/presence, never keys. */
async function buildProviderHealth(
  source: ProviderHealthSource,
  probe: boolean,
): Promise<ProviderHealth> {
  const report = source.report();
  const providers: ProviderHealth['providers'] = [];
  for (const entry of report.providers) {
    const reach =
      probe && source.providerReachability
        ? await source.providerReachability(entry.id)
        : null;
    providers.push({
      id: entry.id,
      model: entry.model,
      enabled: entry.enabled,
      hasKey: entry.hasKey,
      ...(reach ? { reachable: reach.ok } : {}),
    });
  }
  let reachability: ProviderHealth['reachability'];
  if (probe && source.reachability) {
    const conversation = await source.reachability('conversation');
    const memory = await source.reachability('memory');
    reachability = { conversation, memory };
  }
  return {
    source: report.source,
    active: report.active,
    providers,
    ...(reachability ? { reachability } : {}),
  };
}

/**
 * MCP roll-up (M13d): per-server state plus a summary. Disabled or
 * unconfigured reads `unknown` (never claim what was not checked); a
 * failed server is `degraded` for the section. Deliberately does NOT
 * drag the overall report status down — MCP is an additive subsystem,
 * and a missing optional server must not read as a broken platform.
 */
function buildMcpHealth(
  enabled: boolean,
  servers: readonly McpServerHealth[],
): McpHealth {
  const rows = servers.map((server) => ({ ...server }));
  if (!enabled) {
    return {
      status: 'unknown',
      detail: 'MCP disabled (MCP_ENABLED=false)',
      enabled: false,
      servers: rows,
    };
  }
  if (rows.length === 0) {
    return {
      status: 'unknown',
      detail: 'no MCP servers configured',
      enabled: true,
      servers: rows,
    };
  }
  const failed = rows.filter((server) => server.state === 'failed');
  const connected = rows.filter((server) => server.state === 'connected');
  const disabled = rows.filter((server) => server.state === 'disabled');
  if (failed.length > 0) {
    return {
      status: 'degraded',
      detail: `${failed.length} of ${rows.length} MCP servers failed: ${failed
        .map((server) => `${server.name} (${server.reason ?? 'unknown'})`)
        .join(', ')}`,
      enabled: true,
      servers: rows,
    };
  }
  return {
    status: 'healthy',
    detail: `${connected.length} connected, ${disabled.length} disabled`,
    enabled: true,
    servers: rows,
  };
}
