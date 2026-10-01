import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { McpClient, McpClientFactory, McpError } from './mcp-client';
import type {
  McpCallResult,
  McpPrompt,
  McpPromptResult,
  McpResource,
  McpResourceRead,
  McpTool,
} from './mcp-client';
import { McpConnectionService } from './mcp-connection.service';
import { sanitizeReason } from './mcp-connection.service';
import { SecretChangeNotifier } from '../secrets/secret-change.notifier';
import type { McpServerEntry } from './mcp-server-config';

// The catalog watcher is exercised deterministically: the real fs
// functions stay (temp dirs, file writes), only the watcher is stubbed
// so the test drives its callback instead of waiting on OS polling.
jest.mock('node:fs', () => {
  const actual = jest.requireActual<Record<string, unknown>>('node:fs');
  return { ...actual, watchFile: jest.fn(), unwatchFile: jest.fn() };
});

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
    host: '127.0.0.1',
    corsAllowedOrigins: ['http://localhost:4200', 'http://127.0.0.1:4200'],
    exposeAcknowledged: false,
    authEnabled: false,
    authDirPath: '/tmp/icos-test-auth-unused',
    authSessionTtlMs: 2592000000,
    authCookieSecure: false,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'm',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    memoryProspectiveConfidenceThreshold: 0.5,
    memoryRecallConfidenceGate: 0.3,
    memoryRecallExcludeOrigins: [],
    memoryRecallMaxBandTokens: 800,
    memoryRecallTimeoutMs: 5000,
    memoryMaintenanceEnabled: false,
    memoryMaintenanceIntervalMs: 3600000,
    memoryAgentDampening: 0.5,
    mcpEnabled: true,
    mcpServersPath: '',
    mcpTimeoutMs: 1000,
    mcpReconnectBackoffMs: 60000,
    vectorDbPath: '/tmp/icos-test-claims-vector.db',
    skillsDirPath: '/tmp/icos-test-skills-missing',
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: 5,
    agentMaxToolSteps: 5,
    agentMaxTurnDurationMs: 900000,
    realtimeEnabled: false,
    realtimeHeartbeatMs: 30000,
    realtimeAllowedOrigins: ['*'],
    ...overrides,
  };
}

class FakeClient extends McpClient {
  constructor(
    private readonly tools: McpTool[] = [],
    private readonly behavior: {
      connectError?: string;
      callError?: string;
      resources?: McpResource[];
      prompts?: McpPrompt[];
    } = {},
  ) {
    super();
  }

  connect(): Promise<McpTool[]> {
    if (this.behavior.connectError) {
      return Promise.reject(new McpError(this.behavior.connectError, true));
    }
    return Promise.resolve(this.tools);
  }

  async disconnect(): Promise<void> {}

  listTools(): Promise<McpTool[]> {
    return Promise.resolve(this.tools);
  }

  callTool(
    toolName: string,
    _args: Record<string, unknown>,
    _timeoutMs: number,
  ): Promise<McpCallResult> {
    void _args;
    void _timeoutMs;
    if (this.behavior.callError) {
      return Promise.reject(new McpError(this.behavior.callError, true));
    }
    return Promise.resolve({
      text: `called:${toolName}`,
      isError: false,
      attachments: [],
    });
  }

  listResources(): Promise<McpResource[]> {
    return Promise.resolve(this.behavior.resources ?? []);
  }

  readResource(uri: string, maxChars: number): Promise<McpResourceRead> {
    return Promise.resolve({
      uri,
      text: `read:${uri}`.slice(0, maxChars),
      isBinary: false,
      truncated: false,
    });
  }

  listPrompts(): Promise<McpPrompt[]> {
    return Promise.resolve(this.behavior.prompts ?? []);
  }

  getPrompt(
    name: string,
    args: Record<string, string>,
  ): Promise<McpPromptResult> {
    return Promise.resolve({
      messages: [{ role: 'user', text: `${name}:${JSON.stringify(args)}` }],
    });
  }

  /** Simulate an unexpected connection drop (M13f). */
  drop(): void {
    this.onUnavailable?.();
  }
}

class FakeFactory extends McpClientFactory {
  constructor(
    private readonly behavior: (entry: McpServerEntry) => FakeClient = () =>
      new FakeClient([{ name: 'ping', inputSchema: { type: 'object' } }]),
  ) {
    super();
  }

  create(entry: McpServerEntry): McpClient {
    return this.behavior(entry);
  }
}

describe('sanitizeReason', () => {
  it('collapses whitespace and caps length', () => {
    expect(sanitizeReason('a\n\n  b\t c ')).toBe('a b c');
    const long = sanitizeReason(`start ${'x'.repeat(500)}`);
    expect(long.length).toBe(201);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('McpConnectionService', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), 'icos-mcp-conn-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stays dark when disabled, loading nothing', async () => {
    const factory = new FakeFactory(() => {
      throw new Error('must never construct');
    });
    const service = new McpConnectionService(
      testConfig({ mcpEnabled: false }),
      factory,
    );
    await service.initialize();
    expect(service.statusAll()).toEqual([]);
    await service.onModuleDestroy();
  });

  it('connects catalogued servers fail-soft, one failure never blocks others', async () => {
    const path = join(dir, 'mcp-servers.json');
    fs.writeFileSync(
      path,
      JSON.stringify([
        { name: 'good', transport: 'stdio', command: 'x' },
        { name: 'bad', transport: 'stdio', command: 'x' },
        { name: 'off', transport: 'stdio', command: 'x', enabled: false },
      ]),
    );
    const service = new McpConnectionService(
      testConfig({ mcpServersPath: path }),
      new FakeFactory((entry) =>
        entry.name === 'bad'
          ? new FakeClient([], { connectError: 'refused' })
          : new FakeClient([{ name: 'ping', inputSchema: {} }]),
      ),
    );
    await service.initialize();

    expect(service.statusAll()).toMatchObject([
      { name: 'good', state: 'connected', toolCount: 1 },
      { name: 'bad', state: 'failed' },
      { name: 'off', state: 'disabled' },
    ]);
    expect(service.statusOf('good')).toMatchObject({
      transport: 'stdio',
    });
    expect(service.toolsOf('good')).toHaveLength(1);
    expect(service.toolsOf('bad')).toEqual([]);
    expect(service.allTools()).toHaveLength(1);
    expect((await service.callTool('good', 'ping', {})).text).toBe(
      'called:ping',
    );
    await expect(service.callTool('bad', 'ping', {})).rejects.toBeInstanceOf(
      McpError,
    );
    await expect(
      service.callTool('missing', 'ping', {}),
    ).rejects.toBeInstanceOf(McpError);

    // Reconnect retries a failed server (still failing here).
    expect((await service.reconnect('bad'))?.state).toBe('failed');
    expect(await service.reconnect('off')).toBeNull();
    expect(service.statusOf('missing')).toBeNull();
    await service.onModuleDestroy();
  });

  it('surfaces call failures without taking the manager down', async () => {
    const path = join(dir, 'mcp-servers.json');
    fs.writeFileSync(
      path,
      JSON.stringify([{ name: 'flaky', transport: 'stdio', command: 'x' }]),
    );
    const service = new McpConnectionService(
      testConfig({ mcpServersPath: path }),
      new FakeFactory(
        () =>
          new FakeClient([{ name: 'ping', inputSchema: {} }], {
            callError: 'boom',
          }),
      ),
    );
    await service.initialize();
    await expect(service.callTool('flaky', 'ping', {})).rejects.toThrow('boom');
    expect(service.statusOf('flaky')?.state).toBe('connected');
    await service.onModuleDestroy();
  });

  it('notifies tool-set listeners after init and reconnect', async () => {
    const path = join(dir, 'mcp-servers.json');
    fs.writeFileSync(
      path,
      JSON.stringify([{ name: 'good', transport: 'stdio', command: 'x' }]),
    );
    const service = new McpConnectionService(
      testConfig({ mcpServersPath: path }),
      new FakeFactory(),
    );
    const seen: number[] = [];
    const unsubscribe = service.onToolsChanged(() => {
      seen.push(service.allTools().length);
    });
    await service.initialize();
    expect(seen).toEqual([1]);
    await service.reconnect('good');
    expect(seen).toEqual([1, 1]);
    // Unsubscribe stops notifications; a throwing listener never
    // breaks the subject.
    unsubscribe();
    service.onToolsChanged(() => {
      throw new Error('listener bug');
    });
    await service.reconnect('good');
    expect(seen).toEqual([1, 1]);
    await service.onModuleDestroy();
  });

  describe('resources and prompts (M13e)', () => {
    const withServer = (
      behavior: ConstructorParameters<typeof FakeClient>[1] = {},
    ) => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'srv', transport: 'stdio', command: 'x' }]),
      );
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(() => new FakeClient([], behavior)),
      );
      return service;
    };

    it('lists resources and reads one through the connected client', async () => {
      const service = withServer({
        resources: [{ uri: 'file:///a', name: 'a', mimeType: 'text/plain' }],
      });
      await service.initialize();
      expect(await service.listResources('srv')).toEqual([
        { uri: 'file:///a', name: 'a', mimeType: 'text/plain' },
      ]);
      expect(await service.readResource('srv', 'file:///a')).toMatchObject({
        uri: 'file:///a',
        text: 'read:file:///a',
        isBinary: false,
      });
      await service.onModuleDestroy();
    });

    it('lists prompts and fetches one with named arguments', async () => {
      const service = withServer({
        prompts: [{ name: 'greet', arguments: [] }],
      });
      await service.initialize();
      expect(await service.listPrompts('srv')).toEqual([
        { name: 'greet', arguments: [] },
      ]);
      expect(
        await service.getPrompt('srv', 'greet', { who: 'rob' }),
      ).toMatchObject({ messages: [{ role: 'user' }] });
      await service.onModuleDestroy();
    });

    it('refuses reads through a server that is not connected', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(path, JSON.stringify([]));
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(),
      );
      await service.initialize();
      await expect(service.listResources('missing')).rejects.toBeInstanceOf(
        McpError,
      );
      await expect(
        service.readResource('missing', 'file:///a'),
      ).rejects.toBeInstanceOf(McpError);
      await expect(service.listPrompts('missing')).rejects.toBeInstanceOf(
        McpError,
      );
      await expect(
        service.getPrompt('missing', 'greet', {}),
      ).rejects.toBeInstanceOf(McpError);
      await service.onModuleDestroy();
    });
  });

  describe('secret changes (S3)', () => {
    const writeCatalog = (path: string): void =>
      fs.writeFileSync(
        path,
        JSON.stringify([
          {
            name: 'a',
            transport: 'stdio',
            command: 'x',
            env: { API_KEY: 'secret:shared' },
          },
          {
            name: 'b',
            transport: 'stdio',
            command: 'y',
            env: { OTHER: 'secret:other' },
          },
        ]),
      );

    it('reconnects only servers that reference the changed secret', async () => {
      const path = join(dir, 'mcp-servers.json');
      writeCatalog(path);
      const created: string[] = [];
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory((entry) => {
          created.push(entry.name);
          return new FakeClient([{ name: 'ping', inputSchema: {} }]);
        }),
      );
      await service.initialize();
      expect(created).toEqual(['a', 'b']);

      const reconnected = await service.reconnectReferencing('secret:shared');
      expect(reconnected).toEqual(['a']);
      expect(created).toEqual(['a', 'b', 'a']);
      await service.onModuleDestroy();
    });

    it('reconnects dependents when a secret change is announced', async () => {
      const path = join(dir, 'mcp-servers.json');
      writeCatalog(path);
      const created: string[] = [];
      const notifier = new SecretChangeNotifier();
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory((entry) => {
          created.push(entry.name);
          return new FakeClient([{ name: 'ping', inputSchema: {} }]);
        }),
        notifier,
      );
      await service.onModuleInit();
      expect(created).toEqual(['a', 'b']);

      notifier.notify('secret:other');
      // reconnect is fire-and-forget from the notifier; let it settle.
      const deadline = Date.now() + 2000;
      while (created.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(created).toEqual(['a', 'b', 'b']);
      await service.onModuleDestroy();
    });
  });

  describe('drop detection (M13f)', () => {
    it('marks a lost connection failed, drops tools, then retries', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
      );
      const clients: FakeClient[] = [];
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path, mcpReconnectBackoffMs: 40 }),
        new FakeFactory(() => {
          const client = new FakeClient([{ name: 'ping', inputSchema: {} }]);
          clients.push(client);
          return client;
        }),
      );
      const seen: number[] = [];
      service.onToolsChanged(() => seen.push(service.allTools().length));
      await service.initialize();
      expect(service.statusOf('a')).toMatchObject({
        state: 'connected',
        toolCount: 1,
      });
      expect(seen).toEqual([1]);

      // Unexpected drop: server fails, tools leave, listeners fire.
      clients[0].drop();
      expect(service.statusOf('a')).toMatchObject({
        state: 'failed',
        reason: 'connection lost',
        toolCount: 0,
      });
      expect(service.allTools()).toEqual([]);
      expect(seen).toEqual([1, 0]);

      // Backoff retry reconnects with a fresh client.
      const deadline = Date.now() + 15000;
      while (
        service.statusOf('a')?.state !== 'connected' &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(service.statusOf('a')?.state).toBe('connected');
      expect(clients).toHaveLength(2);
      await service.onModuleDestroy();
    });

    it('ignores a drop from a client the manager already replaced', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
      );
      const clients: FakeClient[] = [];
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(() => {
          const client = new FakeClient([{ name: 'ping', inputSchema: {} }]);
          clients.push(client);
          return client;
        }),
      );
      await service.initialize();
      await service.reconnect('a');
      clients[0].drop();
      // The stale client must not disturb the live one.
      expect(service.statusOf('a')?.state).toBe('connected');
      await service.onModuleDestroy();
    });
  });

  describe('reload (M13d)', () => {
    it('is a no-op report when MCP is disabled', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
      );
      const service = new McpConnectionService(
        testConfig({ mcpEnabled: false, mcpServersPath: path }),
        new FakeFactory(() => {
          throw new Error('must never construct');
        }),
      );
      const report = await service.reload();
      expect(report).toEqual({
        enabled: false,
        path: '',
        servers: [],
        errors: [],
      });
      expect(service.statusAll()).toEqual([]);
      await service.onModuleDestroy();
    });

    it('diffs the set: connects new, drops removed, leaves healthy alone', async () => {
      const path = join(dir, 'mcp-servers.json');
      const write = (entries: unknown[]): void =>
        fs.writeFileSync(path, JSON.stringify(entries));
      const created: string[] = [];
      const factory = new FakeFactory((entry) => {
        created.push(entry.name);
        return new FakeClient([{ name: 'ping', inputSchema: {} }]);
      });
      write([{ name: 'a', transport: 'stdio', command: 'x' }]);
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        factory,
      );
      await service.initialize();
      expect(created).toEqual(['a']);

      // Add 'b', leave 'a' intact: 'a' must NOT be reconnected.
      write([
        { name: 'a', transport: 'stdio', command: 'x' },
        { name: 'b', transport: 'stdio', command: 'y' },
      ]);
      let report = await service.reload();
      expect(created).toEqual(['a', 'b']);
      expect(report.servers.map((s) => `${s.name}=${s.state}`)).toEqual([
        'a=connected',
        'b=connected',
      ]);

      // Drop 'a', keep 'b': 'a' disconnects and disappears.
      write([{ name: 'b', transport: 'stdio', command: 'y' }]);
      report = await service.reload();
      expect(created).toEqual(['a', 'b']);
      expect(report.servers.map((s) => s.name)).toEqual(['b']);
      expect(service.statusOf('a')).toBeNull();
      await service.onModuleDestroy();
    });

    it('reconnects changed entries and honors disabled flips', async () => {
      const path = join(dir, 'mcp-servers.json');
      const write = (entries: unknown[]): void =>
        fs.writeFileSync(path, JSON.stringify(entries));
      const created: string[] = [];
      const factory = new FakeFactory((entry) => {
        created.push(`${entry.name}:${entry.command ?? entry.url ?? ''}`);
        return new FakeClient([{ name: 'ping', inputSchema: {} }]);
      });
      write([{ name: 'a', transport: 'stdio', command: 'x' }]);
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        factory,
      );
      await service.initialize();

      // Same name, changed command → reconnect (create again).
      write([{ name: 'a', transport: 'stdio', command: 'x2' }]);
      await service.reload();
      expect(created).toEqual(['a:x', 'a:x2']);

      // Flip to disabled → state disabled, tools dropped, no new create.
      write([{ name: 'a', transport: 'stdio', command: 'x2', enabled: false }]);
      const report = await service.reload();
      expect(created).toEqual(['a:x', 'a:x2']);
      expect(report.servers[0]).toMatchObject({
        name: 'a',
        state: 'disabled',
        toolCount: 0,
      });
      await service.onModuleDestroy();
    });

    it('reports catalog parse errors without throwing', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(path, '{ not json');
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(),
      );
      const report = await service.reload();
      expect(report.enabled).toBe(true);
      expect(report.servers).toEqual([]);
      expect(report.errors).toHaveLength(1);
      await service.onModuleDestroy();
    });

    it('debounces catalog changes into a single reload', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
      );
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(
          () => new FakeClient([{ name: 'ping', inputSchema: {} }]),
        ),
      );
      await service.initialize();
      expect(service.statusOf('a')?.state).toBe('connected');

      // Deterministic watch entry point — no OS-event dependency.
      fs.writeFileSync(
        path,
        JSON.stringify([
          { name: 'a', transport: 'stdio', command: 'x' },
          { name: 'b', transport: 'stdio', command: 'y' },
        ]),
      );
      service.handleCatalogFileEvent();
      service.handleCatalogFileEvent();
      const deadline = Date.now() + 3000;
      while (
        service.statusOf('b')?.state !== 'connected' &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(service.statusOf('b')?.state).toBe('connected');
      await service.onModuleDestroy();
    });

    it('registers a catalog file watch on boot', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
      );
      const watchMock = fs.watchFile as unknown as jest.Mock;
      const unwatchMock = fs.unwatchFile as unknown as jest.Mock;
      watchMock.mockClear();
      unwatchMock.mockClear();

      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(
          () => new FakeClient([{ name: 'ping', inputSchema: {} }]),
        ),
      );
      await service.onModuleInit();
      expect(service.statusOf('a')?.state).toBe('connected');

      // The watcher is registered on the resolved catalog path; its
      // callback drives the already-tested debounced reload.
      expect(watchMock).toHaveBeenCalledTimes(1);
      const call = watchMock.mock.calls[0] as [
        string,
        { interval: number },
        () => void,
      ];
      expect(call[0]).toBe(path);
      expect(typeof call[1].interval).toBe('number');

      fs.writeFileSync(
        path,
        JSON.stringify([
          { name: 'a', transport: 'stdio', command: 'x' },
          { name: 'b', transport: 'stdio', command: 'y' },
        ]),
      );
      call[2]();
      const deadline = Date.now() + 3000;
      while (
        service.statusOf('b')?.state !== 'connected' &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(service.statusOf('b')?.state).toBe('connected');

      await service.onModuleDestroy();
      expect(unwatchMock).toHaveBeenCalledWith(path);
    });

    it('retries a failed server in the background at the backoff', async () => {
      const path = join(dir, 'mcp-servers.json');
      fs.writeFileSync(
        path,
        JSON.stringify([{ name: 'flaky', transport: 'stdio', command: 'x' }]),
      );
      let attempt = 0;
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path, mcpReconnectBackoffMs: 40 }),
        new FakeFactory(() => {
          attempt += 1;
          return attempt === 1
            ? new FakeClient([], { connectError: 'refused' })
            : new FakeClient([{ name: 'ping', inputSchema: {} }]);
        }),
      );
      try {
        await service.initialize();
        expect(service.statusOf('flaky')?.state).toBe('failed');

        const deadline = Date.now() + 15000;
        while (
          service.statusOf('flaky')?.state !== 'connected' &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(service.statusOf('flaky')?.state).toBe('connected');
      } finally {
        await service.onModuleDestroy();
      }
    }, 20000);
  });
});
