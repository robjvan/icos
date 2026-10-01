import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { McpConnectionService } from './mcp-connection.service';
import { toArgsSchema, toNamespacedName } from './mcp-tool-bridge';
import type { TranslatedSchema } from './mcp-tool-bridge';
import type { ApprovalPolicy, ForeignToolSource } from '../tools/tool-registry';

/** A live foreign descriptor (built, never hand-written). */
export interface ForeignToolDescriptor {
  readonly name: string;
  readonly server: string;
  readonly tool: string;
  readonly description: string;
  readonly approval: ApprovalPolicy;
  readonly argsSchema: TranslatedSchema;
}

/**
 * Foreign tool source (M13b): discovers MCP tools through the
 * connection manager and serves sanitized descriptors + arg
 * validation to the registry. Refresh is explicit (boot, reload,
 * reconnect) — planning reads a snapshot, never a live socket.
 * Tools that fail sanitization or schema translation are hidden
 * with a logged reason (fail closed, never widened).
 */
@Injectable()
export class McpToolBridge implements ForeignToolSource, OnModuleInit {
  private readonly logger = new Logger(McpToolBridge.name);
  private descriptors: ForeignToolDescriptor[] = [];

  constructor(private readonly connections: McpConnectionService) {}

  /**
   * Boot liveness: subscribe before snapshotting, so a connection
   * init completing after us still re-triggers the rebuild.
   * Either order converges — the snapshot is always rebuilt from
   * current connection state, never deltas.
   */
  onModuleInit(): void {
    this.connections.onToolsChanged(() => {
      this.refresh();
    });
    this.refresh();
  }

  /** Rebuild descriptors from currently connected servers. */
  refresh(): { servers: number; tools: number; hidden: number } {
    const discovered = this.connections.allTools();
    const descriptors: ForeignToolDescriptor[] = [];
    let hidden = 0;
    const seen = new Set<string>();
    for (const { server, tool } of discovered) {
      const name = toNamespacedName(server, tool.name);
      if (!name || seen.has(name)) {
        hidden += 1;
        this.logger.warn(
          `MCP tool hidden (${name ? 'duplicate' : 'unsanitizable'}): ${server}/${tool.name}`,
        );
        continue;
      }
      const argsSchema = toArgsSchema(tool.inputSchema);
      if (!argsSchema) {
        hidden += 1;
        this.logger.warn(
          `MCP tool hidden (schema outside subset): ${server}/${tool.name}`,
        );
        continue;
      }
      seen.add(name);
      const entry = this.connections.entryOf(server);
      descriptors.push({
        name,
        server,
        tool: tool.name,
        description: tool.description?.trim() || `${server}/${tool.name}`,
        approval: entry?.approval ?? 'required',
        argsSchema,
      });
    }
    this.descriptors = descriptors;
    const servers = new Set(discovered.map((entry) => entry.server)).size;
    return { servers, tools: descriptors.length, hidden };
  }

  listForeign(): readonly ForeignToolDescriptor[] {
    return this.descriptors;
  }

  lookupForeign(name: string): ForeignToolDescriptor | undefined {
    return this.descriptors.find((descriptor) => descriptor.name === name);
  }
}
