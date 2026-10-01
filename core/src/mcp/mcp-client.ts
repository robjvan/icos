/**
 * MCP client boundary (M13a). The transport underneath is the
 * official SDK (pinned); this interface is what ICOS owns —
 * connection state, tool discovery, and calls with ICOS-shaped
 * errors. Swapping the transport never touches consumers.
 */
import type { McpServerEntry } from './mcp-server-config';

/** One discovered remote tool (names kept verbatim here). */
export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema for arguments (opaque to the transport). */
  inputSchema: unknown;
}

/** Text-first call result (images/attachments referenced, not embedded). */
export interface McpCallResult {
  /** Combined text content (empty when only attachments returned). */
  text: string;
  /** Remote `isError` flag, mapped to failure upstream. */
  isError: boolean;
  /** Non-text payloads by MIME type (counts, not bytes). */
  attachments: { mimeType: string }[];
}

export type McpConnectionState = 'connected' | 'disabled' | 'failed';

/** Thrown for transport/call failures (fail-soft upstream). */
export class McpError extends Error {
  constructor(
    message: string,
    readonly transient: boolean = false,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export abstract class McpClient {
  /** Connect + initialize + list tools (idempotent). */
  abstract connect(): Promise<McpTool[]>;

  abstract disconnect(): Promise<void>;

  abstract listTools(): Promise<McpTool[]>;

  abstract callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<McpCallResult>;
}

/** Factory seam: tests inject fakes without spawning anything. */
export abstract class McpClientFactory {
  abstract create(entry: McpServerEntry): McpClient;
}
