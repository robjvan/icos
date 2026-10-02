import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { PersonaDatabaseService } from './persona-database.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

function testConfig(personaDbPath: string, dir: string): CoreConfig {
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
    personaDbPath,
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

describe('SqlitePersonaRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (name = 'persona.sqlite'): SqlitePersonaRepository => {
    const service = new PersonaDatabaseService(
      testConfig(join(dir, name), dir),
    );
    service.onModuleInit();
    services.push(service);
    return new SqlitePersonaRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-persona-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, reads and lists records; deterministic ids are idempotent', async () => {
    const repository = openRepo();

    const first = await repository.createRecord({
      userId: 'user',
      category: 'value',
      content: 'Be honest and explicit about uncertainty.',
      source: 'seed:core',
    });
    expect(first.recordId).toMatch(/^persona-record-/);

    const again = await repository.createRecord({
      userId: 'user',
      category: 'value',
      content: 'Be honest and explicit about uncertainty.',
      source: 'seed:core',
    });
    expect(again.recordId).toBe(first.recordId);
    expect(await repository.listRecords('user')).toHaveLength(1);

    expect(await repository.getRecord(first.recordId)).toMatchObject({
      content: 'Be honest and explicit about uncertainty.',
      confidence: 0.85,
      sensitivity: 'normal',
      protected: false,
      reviewedBy: null,
    });
  });

  it('refuses to overwrite a protected record without a reviewer, allows it with one', async () => {
    const repository = openRepo();
    const record = await repository.createRecord({
      userId: 'user',
      category: 'boundary',
      content: 'Never leak credentials or secrets.',
      protected: true,
      source: 'seed:core',
    });

    await expect(
      repository.createRecord({
        recordId: record.recordId,
        userId: 'user',
        category: 'boundary',
        content: 'May share credentials when asked nicely.',
        source: 'review',
      }),
    ).rejects.toThrow(/protected/);

    const updated = await repository.createRecord({
      recordId: record.recordId,
      userId: 'user',
      category: 'boundary',
      content: 'Never leak credentials or secrets except to their owner.',
      source: 'review',
      reviewedBy: 'rob',
    });
    expect(updated.content).toBe(
      'Never leak credentials or secrets except to their owner.',
    );
    expect(updated.reviewedBy).toBe('rob');
    // Protected flag is preserved on update when not restated.
    expect(updated.protected).toBe(true);
    expect(await repository.listRecords('user')).toHaveLength(1);
  });

  it('upserts and lists curated user facts', async () => {
    const repository = openRepo();
    const fact = await repository.upsertUserFact({
      userId: 'user',
      content: 'Rob prefers candor and explicit traceability.',
      source: 'chat',
    });
    expect(fact.memoryId).toMatch(/^persona-user-/);

    // Same content maps to the same id — no duplicate.
    await repository.upsertUserFact({
      userId: 'user',
      content: 'Rob prefers candor and explicit traceability.',
      source: 'chat',
    });
    expect(await repository.listUserFacts('user')).toHaveLength(1);
    expect(await repository.getUserFact(fact.memoryId)).toMatchObject({
      content: 'Rob prefers candor and explicit traceability.',
    });
  });

  it('keeps one relationship row per user and clamps its signals', async () => {
    const repository = openRepo();
    const first = await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 2,
      emotionalTemperature: -3,
      activeNicknames: ['boss'],
      recentDevelopments: ['shipped M13'],
    });
    expect(first.trustLevel).toBe(1);
    expect(first.emotionalTemperature).toBe(-1);
    expect(first.activeNicknames).toEqual(['boss']);

    const second = await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 0.7,
      emotionalTemperature: 0.25,
    });
    expect(second.stateId).toBe(first.stateId);
    // Unspecified fields are preserved, not wiped.
    expect(second.activeNicknames).toEqual(['boss']);
    expect(second.recentDevelopments).toEqual(['shipped M13']);
  });

  it('stages candidates without applying them, idempotently', async () => {
    const repository = openRepo();
    const candidate = await repository.stageCandidate({
      userId: 'user',
      observation: 'Prefers direct feedback over praise.',
      category: 'preference',
      claimId: 'claim-abc',
      source: 'memory-extraction',
      proposedTarget: 'persona_user_model',
    });

    await repository.stageCandidate({
      userId: 'user',
      observation: 'Prefers direct feedback over praise.',
      category: 'preference',
      source: 'memory-extraction',
    });
    const pending = await repository.listPendingCandidates('user');
    expect(pending).toHaveLength(1);
    expect(await repository.getCandidate(candidate.candidateId)).toMatchObject({
      status: 'pending',
      claimId: 'claim-abc',
      proposedTarget: 'persona_user_model',
    });
  });

  it('appends drift entries and lists them', async () => {
    const repository = openRepo();
    const entry = await repository.logDrift({
      userId: 'user',
      subjectId: 'grounding:user',
      severity: 'warning',
      changeType: 'grounding_score_low',
      reason: 'Grounding score below threshold.',
    });
    expect(entry.logId).toMatch(/^persona-drift-/);
    expect(entry.reviewed).toBe(false);

    const recent = await repository.listRecentDrift('user');
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      severity: 'warning',
      changeType: 'grounding_score_low',
    });
  });

  it('persists across close and reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const first = new PersonaDatabaseService(testConfig(path, dir));
    first.onModuleInit();
    await new SqlitePersonaRepository(first).createRecord({
      userId: 'user',
      category: 'self',
      content: 'I am ICOS.',
      source: 'seed:core',
    });
    first.onModuleDestroy();

    const second = new PersonaDatabaseService(testConfig(path, dir));
    second.onModuleInit();
    services.push(second);
    expect(
      await new SqlitePersonaRepository(second).listRecords('user'),
    ).toHaveLength(1);
  });

  it('responds to ping once the schema is open', async () => {
    const repository = openRepo();
    await expect(repository.ping()).resolves.toBeUndefined();
  });

  it('keeps persona tables in their own database, isolated from memory', () => {
    const path = join(dir, 'isolated.sqlite');
    const service = new PersonaDatabaseService(testConfig(path, dir));
    service.onModuleInit();
    services.push(service);

    const db = new Database(path);
    const names = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    db.close();

    expect(names).toEqual(
      expect.arrayContaining([
        'persona_records',
        'persona_user_model',
        'persona_relationship',
        'persona_candidates',
        'persona_drift_log',
      ]),
    );
    // No memory or transcript tables leak into the persona database.
    expect(names).not.toContain('claims');
    expect(names).not.toContain('memory_candidates');
    expect(names).not.toContain('messages');
  });

  it('falls back to a sibling of the memory database when unset', () => {
    const config = testConfig(join(dir, 'ignored.sqlite'), dir);
    delete config.personaDbPath;

    const service = new PersonaDatabaseService(config);
    service.onModuleInit();
    services.push(service);

    expect(existsSync(join(dir, 'persona.db'))).toBe(true);
  });
});
