import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { MemoryDatabaseService } from '../memory/memory-database.service';
import { PersonaCoreService } from './persona-core.service';
import { PersonaDatabaseService } from './persona-database.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

const CORE = [
  '# ICOS Core',
  '',
  '## Ethical Grounding',
  '- Prefer truth over comfort.',
].join('\n');

function testConfig(dir: string, corePath: string): CoreConfig {
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
    sessionDbPath: join(dir, 'sessions.sqlite'),
    memoryDbPath: join(dir, 'memories.sqlite'),
    personaDbPath: join(dir, 'persona.sqlite'),
    personaCorePath: corePath,
    personaCoreRequired: false,
    personaSeedRoot: join(dir, 'seeds'),
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

describe('Persona isolation (M14h)', () => {
  let dir = '';
  let corePath = '';
  let personaDb: PersonaDatabaseService | null = null;
  let memoryDb: MemoryDatabaseService | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-isolation-'));
    corePath = join(dir, 'core.md');
    writeFileSync(corePath, CORE);
  });

  afterEach(() => {
    personaDb?.onModuleDestroy();
    memoryDb?.onModuleDestroy();
    personaDb = null;
    memoryDb = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps persona records and the core intact when memory stores are tampered with', async () => {
    const config = testConfig(dir, corePath);
    personaDb = new PersonaDatabaseService(config);
    personaDb.onModuleInit();
    const repository = new SqlitePersonaRepository(personaDb);
    const core = new PersonaCoreService(config, repository);
    await core.onModuleInit();

    const record = await repository.createRecord({
      userId: 'user',
      category: 'value',
      content: 'Be honest.',
      protected: true,
      source: 'seed:core',
    });
    const coreHash = core.getStatus().hash;
    const coreBytes = readFileSync(corePath, 'utf8');

    // Tamper with the memory database: drop its tables outright.
    memoryDb = new MemoryDatabaseService(config);
    memoryDb.onModuleInit();
    memoryDb.connection.exec(
      'DROP TABLE IF EXISTS claims; DROP TABLE IF EXISTS memory_candidates;',
    );

    // Identity is untouched: separate file, no shared write path.
    const after = await repository.getRecord(record.recordId);
    expect(after).toMatchObject({ content: 'Be honest.', protected: true });
    expect(await repository.listRecords('user')).toHaveLength(1);

    // Re-load the core: hash and bytes are unchanged by memory tampering.
    await core.reload();
    expect(core.isLoaded()).toBe(true);
    expect(core.getStatus().hash).toBe(coreHash);
    expect(readFileSync(corePath, 'utf8')).toBe(coreBytes);
  });
});
