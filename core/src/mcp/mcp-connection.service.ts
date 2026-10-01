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
import type { McpCallResult, McpClient, McpTool } from './mcp-client';
import { loadCatalogFile } from './mcp-server-config';
import type { McpServerEntry } from './mcp-server-config';

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

interface ManagedServer {
  entry: McpServerEntry;
  client: McpClient | null;
  state: McpServerState;
  reason?: string;
  tools: McpTool[];
}

/**
 * MCP connection manager (M13a): owns one client per catalogued
 * server, connects fail-soft at boot (a dead server disables
 * itself loudly, never the boot), and answers discovery + calls
 * for the bridging slice. Reconnect is lazy — a failed server
 * retries on next explicit `reconnect()`, never on a hot turn
 * path. Tool-set listeners (the M13b bridge) fire after boot
 * init and after every reconnect; the future M13d reload trigger
 * notifies through the same seam.
 */
@Injectable()
export class McpConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpConnectionService.name);
  private readonly servers = new Map<string, ManagedServer>();
  private readonly toolListeners = new Set<() => void>();

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly factory: McpClientFactory,
  ) {}

  /** Boot wiring: load catalog, connect enabled servers fail-soft. */
  async onModuleInit(): Promise<void> {
    await this.initialize();
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
    for (const server of this.servers.values()) {
      await server.client?.disconnect().catch(() => {});
      server.client = null;
    }
    this.servers.clear();
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
      const tools = await client.connect();
      managed.client = client;
      managed.state = 'connected';
      managed.reason = undefined;
      managed.tools = tools;
    } catch (err) {
      managed.client = null;
      managed.state = 'failed';
      managed.reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        `MCP server "${entry.name}" disabled: ${managed.reason}`,
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
   * Subscribe to tool-set changes (boot init, reconnect, future
   * reload). Listeners are sync snapshot rebuilds — never socket
   * work — and never break the subject (throws are logged and
   * swallowed). Returns an unsubscribe.
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
