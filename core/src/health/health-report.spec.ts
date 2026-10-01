import type { CoreConfig } from '../config';
import { FakeSessionRepository } from '../conversation/fake-session.repository';
import { SessionStore } from '../conversation/session.store';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { HostHealthProvider } from '../commands/host-health';
import type { HostHealth } from '../commands/host-health';
import { buildHealthReport } from './health-report';
import type { McpServerHealth } from './health-report';

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
    llmModel: 'test-model',
    llmApiKey: 'secret-key-must-never-leak',
    llmTimeoutMs: 1000,
    systemPrompt: 'test-system',
    maxHistory: 50,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: false,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'test-model',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    memoryProspectiveConfidenceThreshold: 0.5,
    memoryRecallConfidenceGate: 0.3,
    memoryRecallExcludeOrigins: [],
    memoryRecallMaxBandTokens: 800,
    memoryRecallTimeoutMs: 5000,
    memoryMaintenanceEnabled: true,
    memoryMaintenanceIntervalMs: 3600000,
    memoryAgentDampening: 0.5,
    mcpEnabled: false,
    mcpServersPath: '',
    mcpTimeoutMs: 30000,
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

const STUB_HOST: HostHealth = {
  os: 'TestOS 1.0',
  arch: 'x86_64',
  uptimeSeconds: 3 * 86400 + 7 * 3600 + 12 * 60,
  cpuCores: 16,
  cpuPercent: 8,
  loadAverage: [1.42, 1.31, 1.18],
  memoryUsedBytes: Math.round(12.4 * 1024 ** 3),
  memoryTotalBytes: Math.round(31.2 * 1024 ** 3),
  diskUsedBytes: 184 * 1024 ** 3,
  diskTotalBytes: 931 * 1024 ** 3,
  gpu: {
    name: 'Test GPU 4060',
    memoryUsedBytes: Math.round(4.8 * 1024 ** 3),
    memoryTotalBytes: 8 * 1024 ** 3,
    temperatureC: 57,
  },
};

function setup(config: CoreConfig = testConfig()) {
  const store = new SessionStore(new FakeSessionRepository(), config);
  const candidates = {
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const host = {
    collect: jest.fn(() => Promise.resolve({ ...STUB_HOST })),
  } as unknown as HostHealthProvider;
  return { store, candidates, host, config };
}

describe('buildHealthReport', () => {
  it('reports healthy runtime and host when all probes pass', async () => {
    const { store, candidates, host, config } = setup();
    const report = await buildHealthReport({
      sessions: store,
      candidates,
      config,
      host,
    });

    expect(report.status).toBe('healthy');
    expect(report.runtime.core.status).toBe('healthy');
    expect(report.runtime.sessions).toMatchObject({
      status: 'healthy',
      detail: 'sessions database ok',
    });
    expect(report.runtime.memory).toMatchObject({
      status: 'healthy',
      detail: 'memory database ok',
    });
    // Configured, not probed: never claim healthy from config alone.
    expect(report.runtime.llm.status).toBe('unknown');
    expect(report.host.os).toBe('TestOS 1.0');
    expect(report.host.cpuPercent).toBe(8);
  });

  it('degrades when a store ping fails', async () => {
    const { store, host, config } = setup();
    const failing = {
      ping: jest.fn(() => Promise.reject(new Error('sessions down'))),
    } as unknown as MemoryCandidateRepository;

    const report = await buildHealthReport({
      sessions: store,
      candidates: failing,
      config,
      host,
    });

    expect(report.status).toBe('degraded');
    expect(report.runtime.memory).toMatchObject({
      status: 'degraded',
      detail: 'sessions down',
    });
  });

  it('degrades when no LLM provider is configured', async () => {
    const { store, candidates, host } = setup(
      testConfig({ llmBaseUrl: '', llmModel: '' }),
    );
    const report = await buildHealthReport({
      sessions: store,
      candidates,
      config: testConfig({ llmBaseUrl: '', llmModel: '' }),
      host,
    });

    expect(report.status).toBe('degraded');
    expect(report.runtime.llm.status).toBe('degraded');
  });

  it('passes through unavailable host probes as null, never failing', async () => {
    const { store, candidates, config } = setup();
    const bare = {
      collect: jest.fn(() =>
        Promise.resolve({
          ...STUB_HOST,
          cpuPercent: null,
          diskUsedBytes: null,
          diskTotalBytes: null,
          gpu: null,
        }),
      ),
    } as unknown as HostHealthProvider;

    const report = await buildHealthReport({
      sessions: store,
      candidates,
      config,
      host: bare,
    });

    expect(report.status).toBe('healthy');
    expect(report.host.cpuPercent).toBeNull();
    expect(report.host.gpu).toBeNull();
  });

  describe('MCP surface (M13d)', () => {
    const mcpWith = (servers: McpServerHealth[]) => ({
      statusAll: () => servers,
    });

    it('is absent when no manager is wired', async () => {
      const { store, candidates, host, config } = setup();
      const report = await buildHealthReport({
        sessions: store,
        candidates,
        config,
        host,
      });
      expect(report.mcp).toBeUndefined();
    });

    it('reads unknown when disabled or unconfigured', async () => {
      const { store, candidates, host } = setup(
        testConfig({ mcpEnabled: false }),
      );
      const disabled = await buildHealthReport({
        sessions: store,
        candidates,
        config: testConfig({ mcpEnabled: false }),
        host,
        mcp: mcpWith([]),
      });
      expect(disabled.mcp).toMatchObject({ status: 'unknown', enabled: false });

      const {
        store: s2,
        candidates: c2,
        host: h2,
      } = setup(testConfig({ mcpEnabled: true }));
      const empty = await buildHealthReport({
        sessions: s2,
        candidates: c2,
        config: testConfig({ mcpEnabled: true }),
        host: h2,
        mcp: mcpWith([]),
      });
      expect(empty.mcp).toMatchObject({
        status: 'unknown',
        enabled: true,
        detail: 'no MCP servers configured',
      });
    });

    it('summarizes connected/disabled and never leaks into overall status', async () => {
      const config = testConfig({ mcpEnabled: true });
      const { store, candidates, host } = setup(config);
      const report = await buildHealthReport({
        sessions: store,
        candidates,
        config,
        host,
        mcp: mcpWith([
          {
            name: 'files',
            transport: 'stdio',
            state: 'connected',
            toolCount: 3,
          },
          {
            name: 'off',
            transport: 'http',
            state: 'disabled',
            reason: 'disabled in catalog',
            toolCount: 0,
          },
        ]),
      });
      expect(report.status).toBe('healthy');
      expect(report.mcp).toMatchObject({
        status: 'healthy',
        enabled: true,
        detail: '1 connected, 1 disabled',
      });
    });

    it('degrades only the MCP section when a server fails', async () => {
      const config = testConfig({ mcpEnabled: true });
      const { store, candidates, host } = setup(config);
      const report = await buildHealthReport({
        sessions: store,
        candidates,
        config,
        host,
        mcp: mcpWith([
          {
            name: 'files',
            transport: 'stdio',
            state: 'failed',
            reason: 'refused',
            toolCount: 0,
          },
        ]),
      });
      expect(report.status).toBe('healthy');
      expect(report.mcp).toMatchObject({ status: 'degraded', enabled: true });
      expect(report.mcp?.detail).toContain('files');
      expect(report.mcp?.detail).toContain('refused');
    });
  });

  describe('provider surface (S4)', () => {
    it('is absent when no registry is wired and never carries a key', async () => {
      const { store, candidates, host, config } = setup();
      const none = await buildHealthReport({
        sessions: store,
        candidates,
        config,
        host,
      });
      expect(none.providers).toBeUndefined();

      const withProviders = await buildHealthReport({
        sessions: store,
        candidates,
        config,
        host,
        providers: {
          report: () => ({
            source: 'catalog',
            active: { conversation: 'openrouter', memory: 'local' },
            providers: [
              {
                id: 'openrouter',
                model: 'deepseek/x',
                baseUrl: 'https://openrouter.ai/api/v1',
                enabled: true,
                hasKey: true,
              },
            ],
          }),
        },
      });
      expect(withProviders.providers).toEqual({
        source: 'catalog',
        active: { conversation: 'openrouter', memory: 'local' },
        providers: [
          {
            id: 'openrouter',
            model: 'deepseek/x',
            enabled: true,
            hasKey: true,
          },
        ],
      });
    });
  });
});
