import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import { SqliteClaimHistoryRepository } from './sqlite-claim-history.repository';

function testConfig(memoryDbPath: string, dir: string): CoreConfig {
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
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath,
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
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
    memoryMaintenanceEnabled: true,
    memoryMaintenanceIntervalMs: 3600000,
    memoryAgentDampening: 0.5,
    mcpEnabled: false,
    mcpServersPath: '',
    mcpTimeoutMs: 30000,
    mcpReconnectBackoffMs: 60000,
    vectorDbPath: join(dir, 'claims-vector-test.db'),
    skillsDirPath: join(dir, 'skills-unused'),
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
  };
}

describe('SqliteClaimHistoryRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (name = 'history.sqlite'): SqliteClaimHistoryRepository => {
    const service = new MemoryDatabaseService(testConfig(join(dir, name), dir));
    service.onModuleInit();
    services.push(service);
    return new SqliteClaimHistoryRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-hist-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('records transitions with audit fields and lists oldest-first', async () => {
    const repository = openRepo();

    const first = await repository.record({
      claimId: 'claim-1',
      transition: 'compound',
      detail: { timesObserved: 3 },
      confidenceBefore: 0.9,
      confidenceAfter: 0.96,
    });
    await repository.record({
      claimId: 'claim-1',
      transition: 'link',
      detail: { related: ['claim-2'] },
      confidenceBefore: null,
      confidenceAfter: null,
    });

    expect(first.id).toBeDefined();
    expect(first.createdAt).toBeDefined();
    const listed = await repository.listByClaimId('claim-1');
    expect(listed.map((row) => row.transition)).toEqual(['compound', 'link']);
    expect(listed[0]).toMatchObject({
      detail: { timesObserved: 3 },
      confidenceBefore: 0.9,
      confidenceAfter: 0.96,
    });
    expect(await repository.listByClaimId('missing')).toEqual([]);
  });

  it('resolves the latest row per transition for level re-derivation', async () => {
    const repository = openRepo();
    await repository.record({
      claimId: 'claim-1',
      transition: 'compound',
      detail: { timesObserved: 2 },
      confidenceBefore: 0.9,
      confidenceAfter: 0.94,
    });
    const latest = await repository.record({
      claimId: 'claim-1',
      transition: 'compound',
      detail: { timesObserved: 3 },
      confidenceBefore: 0.94,
      confidenceAfter: 0.96,
    });

    expect(
      (await repository.latestByClaimAndTransition('claim-1', 'compound'))?.id,
    ).toBe(latest.id);
    expect(
      await repository.latestByClaimAndTransition('claim-1', 'decay'),
    ).toBeNull();
  });
});
