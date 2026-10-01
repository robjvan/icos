import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { McpClient, McpClientFactory, McpError } from './mcp-client';
import type { McpCallResult, McpTool } from './mcp-client';
import { McpConnectionService } from './mcp-connection.service';
import type { McpServerEntry } from './mcp-server-config';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
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

describe('McpConnectionService', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-mcp-conn-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
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
    writeFileSync(
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
    writeFileSync(
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
    writeFileSync(
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

  describe('reload (M13d)', () => {
    it('is a no-op report when MCP is disabled', async () => {
      const path = join(dir, 'mcp-servers.json');
      writeFileSync(
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
        writeFileSync(path, JSON.stringify(entries));
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
        writeFileSync(path, JSON.stringify(entries));
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
      writeFileSync(path, '{ not json');
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

    it('reloads on catalog file change (debounced watch)', async () => {
      const path = join(dir, 'mcp-servers.json');
      writeFileSync(
        path,
        JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
      );
      const service = new McpConnectionService(
        testConfig({ mcpServersPath: path }),
        new FakeFactory(
          () => new FakeClient([{ name: 'ping', inputSchema: {} }]),
        ),
      );
      try {
        await service.onModuleInit();
        expect(service.statusOf('a')?.state).toBe('connected');

        // Add 'b' on disk; the watcher must pick it up without a restart.
        writeFileSync(
          path,
          JSON.stringify([
            { name: 'a', transport: 'stdio', command: 'x' },
            { name: 'b', transport: 'stdio', command: 'y' },
          ]),
        );
        const deadline = Date.now() + 15000;
        while (
          service.statusOf('b')?.state !== 'connected' &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(service.statusOf('b')?.state).toBe('connected');
      } finally {
        await service.onModuleDestroy();
      }
    }, 20000);

    it('retries a failed server in the background at the backoff', async () => {
      const path = join(dir, 'mcp-servers.json');
      writeFileSync(
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
