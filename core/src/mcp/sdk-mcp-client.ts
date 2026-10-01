import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpClient, McpClientFactory, McpError } from './mcp-client';
import type { McpCallResult, McpTool } from './mcp-client';
import { resolveServerEnv } from './mcp-server-config';
import type { McpServerEntry } from './mcp-server-config';

interface ToolContent {
  type?: unknown;
  text?: unknown;
  mimeType?: unknown;
}

function toResult(raw: unknown): McpCallResult {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const content = Array.isArray(record['content'])
    ? (record['content'] as ToolContent[])
    : [];
  const texts: string[] = [];
  const attachments: { mimeType: string }[] = [];
  for (const item of content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      texts.push(item.text);
    } else if (
      (item.type === 'image' || item.type === 'resource') &&
      typeof item.mimeType === 'string'
    ) {
      attachments.push({ mimeType: item.mimeType });
    }
  }
  return {
    text: texts.join('\n'),
    isError: record['isError'] === true,
    attachments,
  };
}

/**
 * SDK-backed MCP client, one per configured server (M13a). Owns a
 * single `Client` + transport; connect is idempotent, calls race
 * their own timeout (never trust a foreign server with the event
 * loop). All failures surface as `McpError` — transient for
 * timeouts and drops (retryable), permanent for protocol errors.
 */
export class SdkMcpClient extends McpClient {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private tools: McpTool[] | null = null;

  constructor(private readonly entry: McpServerEntry) {
    super();
  }

  private buildTransport(): Transport {
    if (this.entry.transport === 'stdio') {
      // Secrets resolve here, at spawn — the catalog carries
      // references, the process carries values. Missing vars throw
      // before spawning (fail closed, names only, never values).
      let extra: Record<string, string>;
      try {
        extra = resolveServerEnv(this.entry.env, this.entry.name);
      } catch (err) {
        throw new McpError(
          err instanceof Error ? err.message : 'invalid server env',
          false,
        );
      }
      return new StdioClientTransport({
        command: this.entry.command ?? '',
        args: this.entry.args ?? [],
        env: { ...process.env, ...extra } as Record<string, string>,
        stderr: 'ignore',
      });
    }
    return new StreamableHTTPClientTransport(new URL(this.entry.url ?? ''));
  }

  async connect(): Promise<McpTool[]> {
    if (this.tools) return this.tools;
    const transport = this.buildTransport();
    const client = new Client(
      { name: 'icos-core', version: '0.0.1' },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
    } catch (err) {
      await client.close().catch(() => {});
      throw new McpError(
        `MCP connect failed for "${this.entry.name}": ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        true,
      );
    }
    this.client = client;
    this.transport = transport;
    return this.listTools();
  }

  async disconnect(): Promise<void> {
    this.tools = null;
    const client = this.client;
    this.client = null;
    this.transport = null;
    if (client) {
      await client.close().catch(() => {});
    }
  }

  async listTools(): Promise<McpTool[]> {
    if (this.tools) return this.tools;
    const client = this.client;
    if (!client) {
      throw new McpError(
        `MCP client for "${this.entry.name}" is not connected`,
        true,
      );
    }
    try {
      const { tools } = await client.listTools();
      this.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return this.tools;
    } catch (err) {
      throw new McpError(
        `MCP tools/list failed for "${this.entry.name}": ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        true,
      );
    }
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<McpCallResult> {
    const client = this.client;
    if (!client) {
      throw new McpError(
        `MCP client for "${this.entry.name}" is not connected`,
        true,
      );
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('mcp_call_timeout')),
            timeoutMs,
          );
        }),
      ]);
      return toResult(result);
    } catch (err) {
      const transient =
        err instanceof Error && err.message === 'mcp_call_timeout';
      throw new McpError(
        `MCP tools/call failed for "${this.entry.name}/${toolName}": ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        transient,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export class SdkMcpClientFactory extends McpClientFactory {
  create(entry: McpServerEntry): McpClient {
    return new SdkMcpClient(entry);
  }
}
