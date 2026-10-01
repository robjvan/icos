import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { McpError } from './mcp-client';
import { SdkMcpClient } from './sdk-mcp-client';
import type { McpServerEntry } from './mcp-server-config';

/**
 * In-process MCP server transport (M13f transport matrix): a faithful
 * enough JSON-RPC peer to exercise the SDK client's connect / discover
 * / call / timeout / malformed / drop paths without spawning anything.
 */
class FakeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  sessionId?: string;

  private closed = false;
  /** Methods that never answer (exercise the timeout race). */
  silentMethods = new Set<string>();
  /** Methods that answer with a non-object payload (malformed). */
  garbageMethods = new Set<string>();
  /** Methods that answer with a JSON-RPC error (missing capability). */
  failingMethods = new Set<string>();
  /** Per-method result overrides for a specific case. */
  resultOverrides = new Map<string, unknown>();

  start(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.onclose?.();
    return Promise.resolve();
  }

  /** Simulate the peer dropping the connection. */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions,
  ): Promise<void> {
    void _options;
    const request = message as { id?: unknown; method?: string };
    if (request.method === undefined || request.id === undefined) {
      // Notification (e.g. notifications/initialized): no response.
      return Promise.resolve();
    }
    queueMicrotask(() => this.respond(request.id, request.method as string));
    return Promise.resolve();
  }

  private respond(id: unknown, method: string): void {
    if (this.silentMethods.has(method)) return;
    if (this.garbageMethods.has(method)) {
      // JSON-RPC-valid but structurally odd: no expected fields.
      this.deliver({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (this.failingMethods.has(method)) {
      this.deliver({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      });
      return;
    }
    const result = this.resultOverrides.has(method)
      ? this.resultOverrides.get(method)
      : this.resultFor(method);
    if (result === undefined) {
      this.deliver({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      });
      return;
    }
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private resultFor(method: string): unknown {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'fake', version: '1.0.0' },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: [
            {
              name: 'echo',
              description: 'Echo text',
              inputSchema: { type: 'object' },
            },
          ],
        };
      case 'tools/call':
        return { content: [{ type: 'text', text: 'hi' }], isError: false };
      case 'resources/list':
        return { resources: [{ uri: 'demo://x', name: 'x' }] };
      case 'resources/read':
        return { contents: [{ uri: 'demo://x', text: 'body' }] };
      case 'prompts/list':
        return { prompts: [{ name: 'greet', arguments: [] }] };
      case 'prompts/get':
        return {
          description: 'g',
          messages: [
            { role: 'user', content: { type: 'text', text: 'hello' } },
          ],
        };
      default:
        return undefined;
    }
  }

  private deliver(message: unknown): void {
    this.onmessage?.(message as JSONRPCMessage);
  }
}

const ENTRY: McpServerEntry = {
  name: 'fake',
  transport: 'stdio',
  command: 'unused',
};

class TestClient extends SdkMcpClient {
  constructor(private readonly fake: FakeTransport) {
    super(ENTRY);
  }

  protected override buildTransport(): Transport {
    return this.fake;
  }
}

describe('SdkMcpClient transport matrix (M13f)', () => {
  it('connects, discovers tools, and maps a text call', async () => {
    const transport = new FakeTransport();
    const client = new TestClient(transport);

    expect(await client.connect()).toEqual([
      {
        name: 'echo',
        description: 'Echo text',
        inputSchema: { type: 'object' },
      },
    ]);
    expect(await client.callTool('echo', { text: 'x' }, 1000)).toEqual({
      text: 'hi',
      isError: false,
      attachments: [],
    });
    await client.disconnect();
  });

  it('maps isError and non-text content without embedding', async () => {
    const transport = new FakeTransport();
    transport.resultOverrides.set('tools/call', {
      content: [
        { type: 'text', text: 'partial' },
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
      ],
      isError: true,
    });
    const client = new TestClient(transport);
    await client.connect();

    expect(await client.callTool('echo', {}, 1000)).toEqual({
      text: 'partial',
      isError: true,
      attachments: [{ mimeType: 'image/png' }],
    });
    await client.disconnect();
  });

  it('times out a silent call with a transient, sanitized error', async () => {
    const transport = new FakeTransport();
    transport.silentMethods.add('tools/call');
    const client = new TestClient(transport);
    await client.connect();

    await expect(client.callTool('echo', {}, 25)).rejects.toMatchObject({
      name: 'McpError',
      transient: true,
    });
    await expect(client.callTool('echo', {}, 25)).rejects.toBeInstanceOf(
      McpError,
    );
    await client.disconnect();
  });

  it('survives a malformed payload as an empty result, never a crash', async () => {
    const transport = new FakeTransport();
    transport.garbageMethods.add('tools/call');
    const client = new TestClient(transport);
    await client.connect();

    expect(await client.callTool('echo', {}, 1000)).toEqual({
      text: '',
      isError: false,
      attachments: [],
    });
    await client.disconnect();
  });

  it('fails soft when the server lacks a capability', async () => {
    const transport = new FakeTransport();
    transport.failingMethods.add('resources/list');
    const client = new TestClient(transport);
    await client.connect();

    await expect(client.listResources(1000)).rejects.toBeInstanceOf(McpError);
    await client.disconnect();
  });

  it('reads resources and prompt templates', async () => {
    const transport = new FakeTransport();
    const client = new TestClient(transport);
    await client.connect();

    expect(await client.listResources(1000)).toEqual([
      { uri: 'demo://x', name: 'x' },
    ]);
    expect(await client.readResource('demo://x', 100, 1000)).toMatchObject({
      uri: 'demo://x',
      text: 'body',
      isBinary: false,
    });
    expect(await client.listPrompts(1000)).toEqual([
      { name: 'greet', arguments: [] },
    ]);
    expect(await client.getPrompt('greet', {}, 100, 1000)).toMatchObject({
      messages: [{ role: 'user', text: 'hello' }],
    });
    await client.disconnect();
  });

  it('signals unavailable on an unexpected drop, not on disconnect', async () => {
    const transport = new FakeTransport();
    const client = new TestClient(transport);
    const drops: string[] = [];
    client.onUnavailable = () => drops.push('dropped');
    await client.connect();

    // Intentional disconnect never signals.
    await client.disconnect();
    expect(drops).toEqual([]);

    // A real drop does — and calls after it fail soft.
    const secondTransport = new FakeTransport();
    const second = new TestClient(secondTransport);
    const secondDrops: string[] = [];
    second.onUnavailable = () => secondDrops.push('dropped');
    await second.connect();
    secondTransport.drop();
    expect(secondDrops).toEqual(['dropped']);
    await expect(second.callTool('echo', {}, 100)).rejects.toBeInstanceOf(
      McpError,
    );
  });
});
