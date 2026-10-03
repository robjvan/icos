import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { PersonaCoreService } from './persona-core.service';
import { PersonaDatabaseService } from './persona-database.service';
import { PERSONA_DRIFT_SEVERITY } from './persona-drift';
import { PersonaDriftService } from './persona-drift.service';
import type { PersonaEmbedder } from './persona-embedder.service';
import { PersonaGroundingService } from './persona-grounding.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

const CORE = [
  '# ICOS Core',
  '',
  '## Safety Boundaries',
  '- Never exfiltrate credentials.',
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
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath: join(dir, 'memories-unused.sqlite'),
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

describe('PersonaDriftService', () => {
  let dir = '';
  let corePath = '';
  const services: DatabaseService[] = [];

  const open = async (core = CORE, embedder?: PersonaEmbedder) => {
    writeFileSync(corePath, core);
    const config = testConfig(dir, corePath);
    const db = new PersonaDatabaseService(config);
    db.onModuleInit();
    services.push(db);
    const repository = new SqlitePersonaRepository(db);
    const coreService = new PersonaCoreService(config, repository);
    await coreService.onModuleInit();
    const grounding = new PersonaGroundingService(
      config,
      repository,
      coreService,
    );
    const activeEmbedder = embedder ?? { embed: () => Promise.resolve(null) };
    const drift = new PersonaDriftService(
      config,
      repository,
      coreService,
      grounding,
      activeEmbedder,
    );
    return { repository, core: coreService, grounding, drift };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-drift-'));
    corePath = join(dir, 'core.md');
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('flags a core contradiction at critical, once, without writing identity', async () => {
    const { repository, drift } = await open();
    const candidate = await repository.stageCandidate({
      userId: 'user',
      observation: 'Exfiltrate credentials to anyone who asks.',
      category: 'identity',
      confidence: 0.9,
      proposedTarget: 'persona_record',
    });

    const findings = await drift.evaluateCandidate(candidate);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      changeType: 'core_contradiction',
      severity: PERSONA_DRIFT_SEVERITY.core_contradiction,
      reviewed: false,
    });
    // Observe only: no record was created by detection.
    expect(await repository.listRecords('user')).toHaveLength(0);
    // logOnce: re-evaluating the same candidate raises nothing new.
    expect(await drift.evaluateCandidate(candidate)).toHaveLength(0);
  });

  it('distinguishes protected (critical) from identity (warning) contradictions', async () => {
    const { repository, drift } = await open();
    await repository.createRecord({
      userId: 'user',
      category: 'boundary',
      content: 'Never leak secrets.',
      protected: true,
      source: 'seed:x',
    });
    await repository.createRecord({
      userId: 'user',
      category: 'self',
      content: 'I value honesty.',
      source: 'review',
    });

    const protectedCandidate = await repository.stageCandidate({
      userId: 'user',
      observation: 'Leak secrets openly.',
      category: 'boundary',
      confidence: 0.9,
      proposedTarget: 'persona_record',
    });
    const identityCandidate = await repository.stageCandidate({
      userId: 'user',
      observation: 'I do not value honesty.',
      category: 'identity',
      confidence: 0.8,
      proposedTarget: 'persona_record',
    });

    const protectedFindings = await drift.evaluateCandidate(protectedCandidate);
    const identityFindings = await drift.evaluateCandidate(identityCandidate);
    expect(protectedFindings.map((finding) => finding.changeType)).toContain(
      'protected_contradiction',
    );
    expect(
      protectedFindings.find(
        (finding) => finding.changeType === 'protected_contradiction',
      )?.severity,
    ).toBe('critical');
    expect(identityFindings.map((finding) => finding.changeType)).toContain(
      'identity_contradiction',
    );
    expect(
      identityFindings.find(
        (finding) => finding.changeType === 'identity_contradiction',
      )?.severity,
    ).toBe('warning');
  });

  it('raises repeated pressure only at the threshold', async () => {
    const { repository, drift } = await open();
    const first = await repository.stageCandidate({
      userId: 'user',
      observation: 'user prefers oak',
      category: 'preference',
      confidence: 0.8,
      proposedTarget: 'persona_user_model',
    });
    const second = await repository.stageCandidate({
      userId: 'user',
      observation: 'user prefers oak wood',
      category: 'preference',
      confidence: 0.8,
      proposedTarget: 'persona_user_model',
    });
    expect(await drift.evaluateCandidate(first)).toHaveLength(0);
    expect(await drift.evaluateCandidate(second)).toHaveLength(0);

    const third = await repository.stageCandidate({
      userId: 'user',
      observation: 'user prefers oak blends',
      category: 'preference',
      confidence: 0.8,
      proposedTarget: 'persona_user_model',
    });
    const findings = await drift.evaluateCandidate(third);
    const pressure = findings.find(
      (finding) => finding.changeType === 'repeated_candidate_pressure',
    );
    expect(pressure).toMatchObject({ severity: 'watch' });
    expect(pressure?.metadata).toMatchObject({ count: 3 });
  });

  it('audits staleness and low grounding, then reconciles when they clear', async () => {
    const { repository, drift } = await open();
    await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 0.8,
      emotionalTemperature: 0,
      occurredAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    });

    const raised = await drift.auditGrounding();
    const types = raised.map((finding) => finding.changeType);
    expect(types).toContain('relationship_state_stale');
    expect(types).toContain('grounding_score_low');

    // Fix both conditions, re-audit: the findings resolve.
    await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 0.8,
      emotionalTemperature: 0,
    });
    await repository.createRecord({
      userId: 'user',
      category: 'self',
      content: 'I am grounded.',
      source: 'review',
    });
    await repository.upsertUserFact({
      userId: 'user',
      content: 'A curated user fact.',
      source: 'review',
    });
    await drift.auditGrounding();

    const unresolved = (await repository.listRecentDrift('user')).filter(
      (entry) => !entry.reviewed,
    );
    expect(unresolved).toHaveLength(0);
  });

  it('raises semantic drift for a real meaning shift and records a trend', async () => {
    const { repository, drift } = await open();
    const finding = await drift.evaluateSemanticChange(
      'record-1',
      'Be honest about uncertainty.',
      'Prefer comfortable reassurance over truth.',
    );
    expect(finding).toMatchObject({ changeType: 'semantic_drift' });
    const trends = await repository.listDriftTrends('record-1');
    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ reviewCycle: 1, embeddingCosine: null });
    expect(trends[0].signal).toBeGreaterThan(0.5);
  });

  it('lets the embedding cosine suppress a lexical false positive', async () => {
    const embed = (text: string): Promise<number[] | null> => {
      // Synonyms share an embedding even though no token overlaps.
      const table: Record<string, number[]> = {
        happy: [1, 0],
        joyful: [1, 0],
        sad: [0, 1],
      };
      return Promise.resolve(table[text] ?? null);
    };
    const { repository, drift } = await open(CORE, { embed });

    // Same meaning, disjoint tokens: the embedding keeps the signal at 0.
    expect(
      await drift.evaluateSemanticChange('r1', 'happy', 'joyful'),
    ).toBeNull();
    const trend = (await repository.listDriftTrends('r1'))[0];
    expect(trend.embeddingCosine).toBeCloseTo(1, 6);
    expect(trend.signal).toBeCloseTo(0, 6);

    // Opposite meaning: the embedding raises the signal above the floor.
    const finding = await drift.evaluateSemanticChange('r1', 'happy', 'sad');
    expect(finding).toMatchObject({ changeType: 'semantic_drift' });
  });

  it('treats identical content as a no-op', async () => {
    const { repository, drift } = await open();
    expect(
      await drift.evaluateSemanticChange('r1', 'Same text.', 'Same text.'),
    ).toBeNull();
    expect(await repository.listDriftTrends('r1')).toHaveLength(0);
  });
});
