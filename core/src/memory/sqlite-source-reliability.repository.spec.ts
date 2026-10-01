import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import { SqliteSourceReliabilityRepository } from './sqlite-source-reliability.repository';

function testConfig(memoryDbPath: string, dir: string): CoreConfig {
  return {
    port: 3000,
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

describe('SqliteSourceReliabilityRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (
    name = 'reliability.sqlite',
  ): SqliteSourceReliabilityRepository => {
    const service = new MemoryDatabaseService(testConfig(join(dir, name), dir));
    service.onModuleInit();
    services.push(service);
    return new SqliteSourceReliabilityRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-rel-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('accrues wins and losses per source, null when unknown', async () => {
    const repository = openRepo();

    expect(await repository.get('user/m')).toBeNull();
    await repository.recordOutcome('user/m', true);
    await repository.recordOutcome('user/m', false);
    await repository.recordOutcome('user/m', false);
    expect(await repository.get('user/m')).toMatchObject({
      sourceKey: 'user/m',
      wins: 1,
      losses: 2,
    });
  });

  it('persists across close and reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const first = new MemoryDatabaseService(testConfig(path, dir));
    first.onModuleInit();
    await new SqliteSourceReliabilityRepository(first).recordOutcome(
      'agent/m',
      false,
    );
    first.onModuleDestroy();

    const second = new MemoryDatabaseService(testConfig(path, dir));
    second.onModuleInit();
    services.push(second);
    expect(
      await new SqliteSourceReliabilityRepository(second).get('agent/m'),
    ).toMatchObject({ wins: 0, losses: 1 });
  });
});
