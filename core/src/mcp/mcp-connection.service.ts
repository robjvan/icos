import { unwatchFile, watchFile } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { McpClientFactory, McpError } from './mcp-client';
import type {
  McpCallResult,
  McpClient,
  McpPrompt,
  McpPromptResult,
  McpResource,
  McpResourceRead,
  McpTool,
} from './mcp-client';
import { MCP_READ_MAX_CHARS } from './mcp-client';
import { loadCatalogFile, resolveCatalogPath } from './mcp-server-config';
import type { McpServerEntry } from './mcp-server-config';
import { SecretChangeNotifier } from '../secrets/secret-change.notifier';

export type McpServerState = 'connected' | 'disabled' | 'failed';

/** Operator-visible per-server state (health surface input). */
export interface McpServerStatus {
  name: string;
  transport: McpServerEntry['transport'];
  state: McpServerState;
  /** Human reason for disabled/failed (never secrets). */
  reason?: string;
  toolCount: number;
}

/** Per-server reload result (same shape as the health surface). */
export interface McpReloadReport {
  /** False when MCP_ENABLED is off — nothing was read or changed. */
  enabled: boolean;
  /** Resolved catalog path (empty when the file is absent). */
  path: string;
  servers: McpServerStatus[];
  /** Human-readable catalog parse/validation problems (never fatal). */
  errors: string[];
}

interface ManagedServer {
  entry: McpServerEntry;
  client: McpClient | null;
  state: McpServerState;
  reason?: string;
  tools: McpTool[];
}

/** Debounce window for catalog file-watch reloads. */
export const CATALOG_WATCH_DEBOUNCE_MS = 250;

/** Cap on operator-visible failure reasons (logs + health). */
export const MAX_REASON_CHARS = 200;

/**
 * Keep failure reasons readable and bounded. A remote server can
 * return an arbitrary body (e.g. an HTML error page); collapsing
 * whitespace and capping length keeps it from flooding logs or the
 * health surface. Never a place for secrets — reasons only ever
 * carry transport text, and env/header values are never echoed.
 */
export function sanitizeReason(message: string): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_REASON_CHARS
    ? `${collapsed.slice(0, MAX_REASON_CHARS)}…`
    : collapsed;
}

/**
 * Catalog poll interval. `fs.watch` is event-driven but documented
 * as inconsistent (events can be dropped); a hand-edited JSON file
 * is cheap to poll and correctness beats latency here.
 */
export const CATALOG_WATCH_INTERVAL_MS = 1000;

/**
 * MCP connection manager (M13a/d): owns one client per catalogued
 * server, connects fail-soft at boot (a dead server disables
 * itself loudly, never the boot), and answers discovery + calls
 * for the bridging slice. Failed servers retry in the background
 * at the configured backoff (unref'd — never blocks shutdown).
 * Tool-set listeners (the M13b bridge) fire after boot init, every
 * reconnect, and every reload.
 */
@Injectable()
export class McpConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpConnectionService.name);
  private readonly servers = new Map<string, ManagedServer>();
  private readonly toolListeners = new Set<() => void>();
  private watchedPath: string | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly factory: McpClientFactory,
    private readonly secretChanges?: SecretChangeNotifier,
  ) {}

  /** Boot wiring: load catalog, connect enabled servers fail-soft. */
  async onModuleInit(): Promise<void> {
    await this.initialize();
    this.startWatching();
    // A rotated or deleted vault secret (S3) must be re-resolved: servers
    // that reference it reconnect, so they pick up the new value or fail
    // closed — never keep a stale, cached value.
    this.secretChanges?.onChange((reference) => {
      void this.reconnectReferencing(reference);
    });
  }

  async initialize(): Promise<void> {
    if (!this.config.mcpEnabled) return;
    const catalog = loadCatalogFile(this.config.mcpServersPath);
    for (const error of catalog.errors) {
      this.logger.warn(`MCP catalog: ${error}`);
    }
    for (const entry of catalog.entries) {
      if (entry.enabled === false) {
        this.servers.set(entry.name, {
          entry,
          client: null,
          state: 'disabled',
          reason: 'disabled in catalog',
          tools: [],
        });
        continue;
      }
      await this.connectOne(entry);
    }
    this.notifyToolsChanged();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.watchedPath) {
      unwatchFile(this.watchedPath);
      this.watchedPath = null;
    }
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const server of this.servers.values()) {
      await server.client?.disconnect().catch(() => {});
      server.client = null;
    }
    this.servers.clear();
  }

  /**
   * Re-read the catalog and reconcile it with live connections
   * (M13d): connect new servers, disconnect removed ones, leave
   * healthy unchanged connections alone, re-connect changed ones.
   * Never throws on a bad server — each fails soft and reports its
   * own state. Off by default: returns a disabled report untouched
   * when MCP_ENABLED is false.
   */
  async reload(): Promise<McpReloadReport> {
    if (!this.config.mcpEnabled) {
      return { enabled: false, path: '', servers: [], errors: [] };
    }
    const catalog = loadCatalogFile(this.config.mcpServersPath);
    for (const error of catalog.errors) {
      this.logger.warn(`MCP catalog: ${error}`);
    }
    const wanted = new Set(catalog.entries.map((entry) => entry.name));
    for (const name of [...this.servers.keys()]) {
      if (!wanted.has(name)) await this.disconnectOne(name);
    }
    for (const entry of catalog.entries) {
      const current = this.servers.get(entry.name);
      if (entry.enabled === false) {
        await this.disableOne(entry, current);
        continue;
      }
      // Leave a healthy, unchanged connection alone; anything else
      // (new, changed, failed, disabled→enabled) re-connects.
      if (
        current &&
        current.state === 'connected' &&
        isDeepStrictEqual(current.entry, entry)
      ) {
        continue;
      }
      await current?.client?.disconnect().catch(() => {});
      await this.connectOne(entry);
    }
    this.notifyToolsChanged();
    return {
      enabled: true,
      path: catalog.path,
      servers: this.statusAll(),
      errors: catalog.errors,
    };
  }

  private async disableOne(
    entry: McpServerEntry,
    current: ManagedServer | undefined,
  ): Promise<void> {
    if (current) {
      await current.client?.disconnect().catch(() => {});
      current.entry = entry;
      current.client = null;
      current.state = 'disabled';
      current.reason = 'disabled in catalog';
      current.tools = [];
      return;
    }
    this.servers.set(entry.name, {
      entry,
      client: null,
      state: 'disabled',
      reason: 'disabled in catalog',
      tools: [],
    });
  }

  private async disconnectOne(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;
    await server.client?.disconnect().catch(() => {});
    server.client = null;
    this.servers.delete(name);
  }

  private async connectOne(entry: McpServerEntry): Promise<void> {
    const managed: ManagedServer = {
      entry,
      client: null,
      state: 'failed',
      reason: 'connecting',
      tools: [],
    };
    this.servers.set(entry.name, managed);
    try {
      const client = this.factory.create(entry);
      // Drop detection (M13f): an unexpected close marks the server
      // unavailable, drops its tools, and schedules a backoff retry.
      client.onUnavailable = () => this.markUnavailable(entry.name, client);
      const tools = await client.connect();
      managed.client = client;
      managed.state = 'connected';
      managed.reason = undefined;
      managed.tools = tools;
    } catch (err) {
      managed.client = null;
      managed.state = 'failed';
      managed.reason = sanitizeReason(
        err instanceof Error ? err.message : 'unknown error',
      );
      this.logger.warn(
        `MCP server "${entry.name}" disabled: ${managed.reason}`,
      );
      this.scheduleRetry();
    }
  }

  /**
   * A live connection dropped on its own (M13f). Stale notifications
   * (a client the manager has already replaced) are ignored. The
   * server drops to `failed`, its tools leave the bridge, and the
   * backoff retries it — turns keep working throughout.
   */
  private markUnavailable(serverName: string, client: McpClient): void {
    const server = this.servers.get(serverName);
    if (!server || server.client !== client) return;
    server.client = null;
    server.state = 'failed';
    server.reason = 'connection lost';
    server.tools = [];
    this.logger.warn(`MCP server "${serverName}" connection lost`);
    this.notifyToolsChanged();
    this.scheduleRetry();
  }

  /**
   * Background reconnect for failed servers, at the configured
   * backoff. Unref'd so it never keeps the process alive; a no-op
   * when MCP is disabled or backoff is 0. Lists are re-read at fire
   * time, so a server that recovered (or was reloaded away) is
   * never reconnected blindly.
   */
  private scheduleRetry(): void {
    if (this.retryTimer) return;
    if (!this.config.mcpEnabled) return;
    const delay = this.config.mcpReconnectBackoffMs;
    if (!Number.isInteger(delay) || delay <= 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryFailed();
    }, delay);
    this.retryTimer.unref?.();
  }

  private async retryFailed(): Promise<void> {
    let retried = false;
    for (const server of [...this.servers.values()]) {
      if (server.state !== 'failed' || server.entry.enabled === false) continue;
      retried = true;
      await this.connectOne(server.entry);
    }
    if (retried) this.notifyToolsChanged();
  }

  /**
   * Watch the catalog file, reloading (debounced) on change. Uses
   * `fs.watchFile` (polling) rather than `fs.watch`: a dropped
   * event on a config file is a real bug, and the file is tiny.
   * Missing files are fine — polling fires when one appears.
   */
  private startWatching(): void {
    if (!this.config.mcpEnabled) return;
    const catalogPath = resolveCatalogPath(this.config.mcpServersPath);
    this.watchedPath = catalogPath;
    watchFile(catalogPath, { interval: CATALOG_WATCH_INTERVAL_MS }, () =>
      this.handleCatalogFileEvent(),
    );
  }

  /**
   * Watch entry point (also the deterministic test seam): a catalog
   * change debounces into one reload. The watcher only fires on the
   * watched path, so no name filtering is needed.
   */
  handleCatalogFileEvent(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null;
      void this.reloadTolerant();
    }, CATALOG_WATCH_DEBOUNCE_MS);
    this.watchTimer.unref?.();
  }

  /** Reload from the watcher; a failure is logged, never thrown. */
  private async reloadTolerant(): Promise<void> {
    try {
      const report = await this.reload();
      this.logger.log(
        `MCP catalog reloaded: ${report.servers
          .map((s) => `${s.name}=${s.state}`)
          .join(', ')}`,
      );
    } catch (err) {
      this.logger.warn(
        `MCP catalog reload failed: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }
  }

  /** Explicit reconnect (manual trigger, reload path, tests). */
  async reconnect(serverName: string): Promise<McpServerStatus | null> {
    const server = this.servers.get(serverName);
    if (!server || server.entry.enabled === false) return null;
    await server.client?.disconnect().catch(() => {});
    server.client = null;
    await this.connectOne(server.entry);
    this.notifyToolsChanged();
    return this.statusOf(serverName);
  }

  /**
   * Reconnect every server whose catalog entry references `reference`
   * (S3). Called when a vault secret changes: a rotated value is
   * re-resolved at spawn, a deleted one fails the server closed. Servers
   * that do not reference it are left untouched.
   */
  async reconnectReferencing(reference: string): Promise<string[]> {
    const names: string[] = [];
    for (const [name, server] of this.servers) {
      if (server.entry.enabled === false) continue;
      const values = [
        ...Object.values(server.entry.env ?? {}),
        ...Object.values(server.entry.headers ?? {}),
      ];
      if (values.includes(reference)) names.push(name);
    }
    for (const name of names) await this.reconnect(name);
    return names;
  }

  /**
   * Subscribe to tool-set changes (boot init, reconnect, reload).
   * Listeners are sync snapshot rebuilds — never socket work — and
   * never break the subject (throws are logged and swallowed).
   * Returns an unsubscribe.
   */
  onToolsChanged(listener: () => void): () => void {
    this.toolListeners.add(listener);
    return () => {
      this.toolListeners.delete(listener);
    };
  }

  private notifyToolsChanged(): void {
    for (const listener of this.toolListeners) {
      try {
        listener();
      } catch (err) {
        this.logger.warn(
          `MCP tool listener failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }
  }

  /** Tools of one connected server (empty when down — never throws). */
  toolsOf(serverName: string): McpTool[] {
    return this.servers.get(serverName)?.tools ?? [];
  }

  /** Catalog entry for policy lookups (null when unknown). */
  entryOf(serverName: string): McpServerEntry | null {
    return this.servers.get(serverName)?.entry ?? null;
  }

  /** All discovered tools with their server attached. */
  allTools(): { server: string; tool: McpTool }[] {
    const out: { server: string; tool: McpTool }[] = [];
    for (const [name, server] of this.servers) {
      if (server.state !== 'connected') continue;
      for (const tool of server.tools) out.push({ server: name, tool });
    }
    return out;
  }

  /** Call through a connected server (throws McpError when down). */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const server = this.servers.get(serverName);
    if (!server || !server.client || server.state !== 'connected') {
      throw new McpError(`MCP server "${serverName}" is not connected`, true);
    }
    return server.client.callTool(toolName, args, this.config.mcpTimeoutMs);
  }

  /**
   * Read-only surfaces (M13e). Lazy and operator-initiated — never
   * auto-injected into context, so they need no approval (writes
   * remain approval-gated, M13b). A server that does not speak
   * resources/prompts fails soft with an `McpError`.
   */
  async listResources(serverName: string): Promise<McpResource[]> {
    return this.requireConnected(serverName).listResources(
      this.config.mcpTimeoutMs,
    );
  }

  async readResource(
    serverName: string,
    uri: string,
    maxChars: number = MCP_READ_MAX_CHARS,
  ): Promise<McpResourceRead> {
    return this.requireConnected(serverName).readResource(
      uri,
      maxChars,
      this.config.mcpTimeoutMs,
    );
  }

  async listPrompts(serverName: string): Promise<McpPrompt[]> {
    return this.requireConnected(serverName).listPrompts(
      this.config.mcpTimeoutMs,
    );
  }

  async getPrompt(
    serverName: string,
    name: string,
    args: Record<string, string>,
    maxChars: number = MCP_READ_MAX_CHARS,
  ): Promise<McpPromptResult> {
    return this.requireConnected(serverName).getPrompt(
      name,
      args,
      maxChars,
      this.config.mcpTimeoutMs,
    );
  }

  private requireConnected(serverName: string): McpClient {
    const server = this.servers.get(serverName);
    if (!server || !server.client || server.state !== 'connected') {
      throw new McpError(`MCP server "${serverName}" is not connected`, true);
    }
    return server.client;
  }

  statusOf(serverName: string): McpServerStatus | null {
    const server = this.servers.get(serverName);
    if (!server) return null;
    return {
      name: server.entry.name,
      transport: server.entry.transport,
      state: server.state,
      ...(server.reason !== undefined ? { reason: server.reason } : {}),
      toolCount: server.tools.length,
    };
  }

  statusAll(): McpServerStatus[] {
    return [...this.servers.keys()]
      .map((name) => this.statusOf(name))
      .filter((status): status is McpServerStatus => status !== null);
  }
}
