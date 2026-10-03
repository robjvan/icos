import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { PersonaDatabaseService } from './persona-database.service';
import { PersonaQueryService } from './persona-query.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

function testConfig(dir: string): CoreConfig {
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
    memoryDbPath: join(dir, 'memories-unused.sqlite'),
    personaDbPath: join(dir, 'persona.sqlite'),
    personaCoreRequired: false,
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

describe('PersonaQueryService', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const open = () => {
    const db = new PersonaDatabaseService(testConfig(dir));
    db.onModuleInit();
    services.push(db);
    const repository = new SqlitePersonaRepository(db);
    return { repository, query: new PersonaQueryService(repository) };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-query-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('projects the evolving tier', async () => {
    const { repository, query } = open();
    await repository.createRecord({
      userId: 'user',
      category: 'value',
      content: 'A value.',
      source: 'review',
    });
    await repository.upsertUserFact({
      userId: 'user',
      content: 'A user fact.',
      source: 'chat',
    });
    await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 0.7,
      emotionalTemperature: 0.1,
    });

    const overview = await query.overview();
    expect(overview.records).toHaveLength(1);
    expect(overview.userFacts).toHaveLength(1);
    expect(overview.relationship?.trustLevel).toBe(0.7);
  });

  it('lists pending candidates and drift', async () => {
    const { repository, query } = open();
    await repository.stageCandidate({
      userId: 'user',
      observation: 'A pending observation.',
      category: 'identity',
      source: 'memory-extraction',
    });
    await repository.logDrift({
      userId: 'user',
      subjectId: 'persona-core',
      severity: 'info',
      changeType: 'persona_core_changed',
      reason: 'edited',
    });

    expect(await query.pending()).toHaveLength(1);
    const drift = await query.drift();
    expect(drift[0]).toMatchObject({ changeType: 'persona_core_changed' });
  });
});
