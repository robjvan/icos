import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { McpClient } from './mcp-client';
import type { McpTool } from './mcp-client';
import { McpConnectionService } from './mcp-connection.service';
import { McpToolBridge } from './mcp-tool-bridge.service';

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
    memoryLlmModel: 'mem',
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
  constructor(private readonly tools: McpTool[] = []) {
    super();
  }

  connect(): Promise<McpTool[]> {
    return Promise.resolve(this.tools);
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  listTools(): Promise<McpTool[]> {
    return Promise.resolve(this.tools);
  }

  callTool(): Promise<never> {
    return Promise.reject(new Error('unused'));
  }
}

describe('McpToolBridge', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-mcp-bridge-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const setup = (tools: McpTool[]) => {
    const path = join(dir, 'mcp-servers.json');
    writeFileSync(
      path,
      JSON.stringify([{ name: 'files', transport: 'stdio', command: 'x' }]),
    );
    const connections = new McpConnectionService(
      testConfig({ mcpServersPath: path }),
      {
        create: () => new FakeClient(tools),
      },
    );
    return { connections, bridge: new McpToolBridge(connections) };
  };

  it('refreshes sanitized descriptors, hiding the unsanitizable', async () => {
    const { connections, bridge } = setup([
      {
        name: 'read',
        description: 'Read a file',
        inputSchema: {
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      { name: '', description: 'nameless', inputSchema: {} },
      {
        name: 'wild',
        description: 'unbounded',
        inputSchema: { properties: { q: { $ref: '#/x' } } },
      },
      { name: 'read', description: 'duplicate', inputSchema: {} },
    ]);
    await connections.initialize();

    const summary = bridge.refresh();
    expect(summary).toMatchObject({ servers: 1, tools: 1, hidden: 3 });
    expect(bridge.listForeign().map((d) => d.name)).toEqual(['mcp_files_read']);
    expect(bridge.listForeign()[0]).toMatchObject({
      server: 'files',
      tool: 'read',
      approval: 'required',
    });
    expect(bridge.lookupForeign('mcp_files_read')?.server).toBe('files');
    expect(bridge.lookupForeign('mcp_files_nope')).toBeUndefined();
    await connections.onModuleDestroy();
  });

  it('rebuilds on boot and on every tool-set change', async () => {
    const { connections, bridge } = setup([
      {
        name: 'read',
        description: 'Read a file',
        inputSchema: {
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]);
    await connections.initialize();
    // Empty before boot wiring, live after — no manual refresh.
    expect(bridge.listForeign()).toEqual([]);
    bridge.onModuleInit();
    expect(bridge.listForeign().map((d) => d.name)).toEqual(['mcp_files_read']);
    // Reconnect notifies through the seam; the snapshot rebuilds.
    await connections.reconnect('files');
    expect(bridge.listForeign().map((d) => d.name)).toEqual(['mcp_files_read']);
    await connections.onModuleDestroy();
  });

  it('honors per-server approval overrides', async () => {
    const path = join(dir, 'mcp-servers.json');
    writeFileSync(
      path,
      JSON.stringify([
        {
          name: 'open',
          transport: 'stdio',
          command: 'x',
          approval: 'none',
        },
      ]),
    );
    const connections = new McpConnectionService(
      testConfig({ mcpServersPath: path }),
      {
        create: () =>
          new FakeClient([{ name: 'go', inputSchema: { properties: {} } }]),
      },
    );
    const bridge = new McpToolBridge(connections);
    await connections.initialize();
    bridge.refresh();
    expect(bridge.lookupForeign('mcp_open_go')?.approval).toBe('none');
    await connections.onModuleDestroy();
  });
});
