import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpClient, McpClientFactory, McpError } from './mcp-client';
import type {
  McpCallResult,
  McpPrompt,
  McpPromptResult,
  McpResource,
  McpResourceRead,
  McpTool,
} from './mcp-client';
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
 * Map an SDK `resources/read` result (M13e): text contents are
 * joined and capped; any blob content marks the resource binary
 * (never decoded/embedded). `isBinary` is true only when there is
 * no text at all — a mixed payload stays readable.
 */
export function toResourceRead(
  raw: unknown,
  uri: string,
  maxChars: number,
): McpResourceRead {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const contents = Array.isArray(record['contents']) ? record['contents'] : [];
  const texts: string[] = [];
  let sawBinary = false;
  let mimeType: string | undefined;
  for (const item of contents) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as { text?: unknown; mimeType?: unknown };
    if (typeof entry.text === 'string') texts.push(entry.text);
    else sawBinary = true;
    if (mimeType === undefined && typeof entry.mimeType === 'string') {
      mimeType = entry.mimeType;
    }
  }
  const joined = texts.join('\n');
  const truncated = joined.length > maxChars;
  return {
    uri,
    ...(mimeType !== undefined ? { mimeType } : {}),
    text: truncated ? joined.slice(0, maxChars) : joined,
    isBinary: sawBinary && texts.length === 0,
    truncated,
  };
}

/**
 * Map an SDK `prompts/get` result (M13e): text messages only, each
 * capped. Non-text or unknown-role messages are dropped rather than
 * guessed — a prompt template is text by contract.
 */
export function toPromptResult(
  raw: unknown,
  maxChars: number,
): McpPromptResult {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const rawMessages = Array.isArray(record['messages'])
    ? record['messages']
    : [];
  const messages: McpPromptResult['messages'] = [];
  for (const item of rawMessages) {
    if (typeof item !== 'object' || item === null) continue;
    const message = item as { role?: unknown; content?: unknown };
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = message.content as { type?: unknown; text?: unknown };
    if (
      typeof content !== 'object' ||
      content === null ||
      content.type !== 'text' ||
      typeof content.text !== 'string'
    ) {
      continue;
    }
    messages.push({
      role: message.role,
      text:
        content.text.length > maxChars
          ? content.text.slice(0, maxChars)
          : content.text,
    });
  }
  return {
    ...(typeof record['description'] === 'string'
      ? { description: record['description'] }
      : {}),
    messages,
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
    return new StreamableHTTPClientTransport(new URL(this.entry.url ?? ''), {
      requestInit: { headers: this.resolveHeaders() },
    });
  }

  /**
   * HTTP headers resolve like stdio env (M13b secrets rule):
   * references from the catalog, values from the process only.
   * Missing vars fail closed here — the manager marks the
   * server failed with the variable name, never any value.
   */
  private resolveHeaders(): Record<string, string> {
    try {
      return resolveServerEnv(this.entry.headers, this.entry.name);
    } catch (err) {
      throw new McpError(
        err instanceof Error ? err.message : 'invalid server headers',
        false,
      );
    }
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

  /**
   * Store capabilities (M13e), all read-only and lazy: nothing is
   * fetched until the operator asks. Each races its own timeout and
   * maps failures to `McpError` (transient for timeouts/drops),
   * exactly like `callTool`. Binary (blob) content is flagged, never
   * decoded or embedded; text is capped at `maxChars`.
   */
  listResources(timeoutMs: number): Promise<McpResource[]> {
    return this.run('resources/list', timeoutMs, async (client) => {
      const { resources } = await client.listResources();
      return (resources ?? []).map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.description !== undefined
          ? { description: resource.description }
          : {}),
        ...(resource.mimeType !== undefined
          ? { mimeType: resource.mimeType }
          : {}),
        ...(resource.size !== undefined ? { size: resource.size } : {}),
      }));
    });
  }

  readResource(
    uri: string,
    maxChars: number,
    timeoutMs: number,
  ): Promise<McpResourceRead> {
    return this.run('resources/read', timeoutMs, async (client) => {
      const result = await client.readResource({ uri });
      return toResourceRead(result, uri, maxChars);
    });
  }

  listPrompts(timeoutMs: number): Promise<McpPrompt[]> {
    return this.run('prompts/list', timeoutMs, async (client) => {
      const { prompts } = await client.listPrompts();
      return (prompts ?? []).map((prompt) => ({
        name: prompt.name,
        ...(prompt.description !== undefined
          ? { description: prompt.description }
          : {}),
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: argument.name,
          ...(argument.description !== undefined
            ? { description: argument.description }
            : {}),
          ...(argument.required !== undefined
            ? { required: argument.required }
            : {}),
        })),
      }));
    });
  }

  getPrompt(
    name: string,
    args: Record<string, string>,
    maxChars: number,
    timeoutMs: number,
  ): Promise<McpPromptResult> {
    return this.run('prompts/get', timeoutMs, async (client) => {
      const result = await client.getPrompt({ name, arguments: args });
      return toPromptResult(result, maxChars);
    });
  }

  private async run<T>(
    label: string,
    timeoutMs: number,
    action: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = this.client;
    if (!client) {
      throw new McpError(
        `MCP client for "${this.entry.name}" is not connected`,
        true,
      );
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        action(client),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('mcp_request_timeout')),
            timeoutMs,
          );
        }),
      ]);
    } catch (err) {
      const transient =
        err instanceof Error && err.message === 'mcp_request_timeout';
      throw new McpError(
        `MCP ${label} failed for "${this.entry.name}": ${
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
