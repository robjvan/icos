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
});
