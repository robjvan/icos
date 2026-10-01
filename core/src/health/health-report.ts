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
  host: HostHealth;
}

export interface HealthReportDeps {
  sessions: SessionStore;
  candidates: MemoryCandidateRepository;
  config: CoreConfig;
  host: HostHealthProvider;
  /** Optional: absent for callers without the MCP manager (slash command). */
  mcp?: McpHealthSource;
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
  // Configured is not healthy: no active probe exists, so reachability
  // stays `unknown` rather than claiming what was never checked.
  const llmConfigured = Boolean(config.llmBaseUrl && config.llmModel);
  const llm: LlmHealthCheck = llmConfigured
    ? {
        status: 'unknown',
        detail: `configured (provider=${config.provider}, model=${config.llmModel}); reachability not probed`,
        provider: config.provider,
        model: config.llmModel,
      }
    : {
        status: 'degraded',
        detail: 'LLM provider not configured',
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
    host: hostHealth,
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
