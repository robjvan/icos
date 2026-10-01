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

/** One listed resource (read-only blob; content fetched on demand). */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

/**
 * A resource read (M13e). Text content is capped at the caller's
 * limit; binary (blob) content is flagged, never decoded or
 * embedded. `truncated` marks a capped text body.
 */
export interface McpResourceRead {
  uri: string;
  mimeType?: string;
  /** Text content (empty for binary resources). */
  text: string;
  /** True when the resource was binary — no text to show. */
  isBinary: boolean;
  truncated: boolean;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** One listed prompt template (no auto-injection; fetched on demand). */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments: McpPromptArgument[];
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  /** Message text (capped at the caller's limit). */
  text: string;
}

export interface McpPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

/** Default read-only cap for resources + prompt text (skill-body scale). */
export const MCP_READ_MAX_CHARS = 12000;

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
  /**
   * Set by the connection manager: invoked once when the connection
   * drops unexpectedly (M13f). Intentional `disconnect()` never
   * fires it. Optional so test doubles can ignore it.
   */
  onUnavailable?: () => void;

  /** Connect + initialize + list tools (idempotent). */
  abstract connect(): Promise<McpTool[]>;

  abstract disconnect(): Promise<void>;

  abstract listTools(): Promise<McpTool[]>;

  abstract callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<McpCallResult>;

  /**
   * M13e read-only surfaces. Default implementations refuse — a
   * server (or test double) that does not speak resources/prompts
   * fails soft with an `McpError`, never a crash. The SDK client
   * overrides them; capabilities differ per server, so callers
   * treat a refusal like any other unreachable capability.
   */
  listResources(_timeoutMs: number): Promise<McpResource[]> {
    void _timeoutMs;
    return Promise.reject(
      new McpError('resources/list not supported by this client', false),
    );
  }

  readResource(
    _uri: string,
    _maxChars: number,
    _timeoutMs: number,
  ): Promise<McpResourceRead> {
    void _uri;
    void _maxChars;
    void _timeoutMs;
    return Promise.reject(
      new McpError('resources/read not supported by this client', false),
    );
  }

  listPrompts(_timeoutMs: number): Promise<McpPrompt[]> {
    void _timeoutMs;
    return Promise.reject(
      new McpError('prompts/list not supported by this client', false),
    );
  }

  getPrompt(
    _name: string,
    _args: Record<string, string>,
    _maxChars: number,
    _timeoutMs: number,
  ): Promise<McpPromptResult> {
    void _name;
    void _args;
    void _maxChars;
    void _timeoutMs;
    return Promise.reject(
      new McpError('prompts/get not supported by this client', false),
    );
  }
}

/** Factory seam: tests inject fakes without spawning anything. */
export abstract class McpClientFactory {
  abstract create(entry: McpServerEntry): McpClient;
}
