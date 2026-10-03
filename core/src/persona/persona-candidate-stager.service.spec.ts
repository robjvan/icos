import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { DatabaseService } from '../session/database.service';
import { PersonaCandidateStager } from './persona-candidate-stager.service';
import { PersonaDatabaseService } from './persona-database.service';
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
    personaCorePath: join(dir, 'core-unused.md'),
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

let counter = 0;
function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  counter += 1;
  return {
    id: `mc-${counter}`,
    kind: 'fact',
    subject: 'user',
    predicate: 'likes',
    object: 'tea',
    confidence: 0.9,
    importance: 0.7,
    stability: 0.8,
    sourceRole: 'user',
    negated: false,
    source: { sessionId: 's1', messageId: 7, role: 'user' },
    extractorModel: 'test-model',
    extractorVersion: 'v1',
    extractedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('PersonaCandidateStager', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const open = () => {
    const db = new PersonaDatabaseService(testConfig(dir));
    db.onModuleInit();
    services.push(db);
    const repository = new SqlitePersonaRepository(db);
    return { repository, stager: new PersonaCandidateStager(repository) };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-stager-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('stages preferences into the user-model queue with provenance', async () => {
    const { repository, stager } = open();
    const staged = await stager.stageFromMemoryCandidates([
      candidate({
        kind: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'oak',
      }),
    ]);
    expect(staged).toBe(1);

    const pending = await repository.listPendingCandidates('user');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      observation: 'user prefers oak',
      category: 'preference',
      proposedTarget: 'persona_user_model',
      source: 'memory-extraction',
      sessionId: 's1',
      sourceTurnId: '7',
    });
    expect(pending[0].metadata).toMatchObject({
      kind: 'preference',
      negated: false,
    });
  });

  it('stages relationship observations into the relationship queue', async () => {
    const { repository, stager } = open();
    await stager.stageFromMemoryCandidates([
      candidate({ kind: 'relationship', subject: 'user', predicate: 'trusts' }),
    ]);
    const pending = await repository.listPendingCandidates('user');
    expect(pending[0]).toMatchObject({
      category: 'relationship',
      proposedTarget: 'persona_relationship',
    });
  });

  it('stages agent-subject facts as identity, skipping other subjects', async () => {
    const { repository, stager } = open();
    const staged = await stager.stageFromMemoryCandidates([
      candidate({
        kind: 'fact',
        subject: 'agent',
        predicate: 'values',
        object: 'clarity',
      }),
      candidate({
        kind: 'fact',
        subject: 'project',
        predicate: 'uses',
        object: 'typescript',
      }),
    ]);
    expect(staged).toBe(1);
    const pending = await repository.listPendingCandidates('user');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      category: 'identity',
      proposedTarget: 'persona_record',
    });
  });

  it('ignores non-identity kinds', async () => {
    const { repository, stager } = open();
    const staged = await stager.stageFromMemoryCandidates([
      candidate({ kind: 'hobby', object: 'cycling' }),
      candidate({ kind: 'person', subject: 'sarah' }),
      candidate({ kind: 'project', subject: 'icos' }),
    ]);
    expect(staged).toBe(0);
    expect(await repository.listPendingCandidates('user')).toHaveLength(0);
  });

  it('is idempotent: re-observing the same triple does not duplicate', async () => {
    const { repository, stager } = open();
    const observation = {
      kind: 'preference' as const,
      subject: 'user',
      predicate: 'prefers',
      object: 'oak',
    };
    await stager.stageFromMemoryCandidates([candidate(observation)]);
    await stager.stageFromMemoryCandidates([candidate(observation)]);
    expect(await repository.listPendingCandidates('user')).toHaveLength(1);
  });

  it('renders negation and never writes a persona record', async () => {
    const { repository, stager } = open();
    await stager.stageFromMemoryCandidates([
      candidate({
        kind: 'preference',
        predicate: 'prefers',
        object: 'pine',
        negated: true,
      }),
    ]);
    const pending = await repository.listPendingCandidates('user');
    expect(pending[0].observation).toContain('not pine');
    // Stage only: the evolving tier stays empty.
    expect(await repository.listRecords('user')).toHaveLength(0);
    expect(await repository.listUserFacts('user')).toHaveLength(0);
  });
});
