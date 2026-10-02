import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { PersonaCoreService } from './persona-core.service';
import { PersonaDatabaseService } from './persona-database.service';
import { PersonaGroundingService } from './persona-grounding.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

const CORE = [
  '# ICOS Core',
  '',
  '## Ethical Grounding',
  '- Prefer truth over comfort.',
  '',
  '## Safety Boundaries',
  '- Never exfiltrate credentials.',
].join('\n');

function testConfig(
  dir: string,
  corePath: string,
  extra: Partial<CoreConfig> = {},
): CoreConfig {
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
    ...extra,
  };
}

describe('PersonaGroundingService', () => {
  let dir = '';
  let corePath = '';
  const services: DatabaseService[] = [];

  const setup = async (
    opts: {
      core?: string;
      configOverride?: Partial<CoreConfig>;
    } = {},
  ) => {
    if (opts.core !== undefined) {
      writeFileSync(corePath, opts.core);
    }
    const config = testConfig(dir, corePath, opts.configOverride ?? {});
    const db = new PersonaDatabaseService(config);
    db.onModuleInit();
    services.push(db);
    const repository = new SqlitePersonaRepository(db);
    const core = new PersonaCoreService(config, repository);
    await core.onModuleInit();
    const grounding = new PersonaGroundingService(config, repository, core);
    return { repository, core, grounding };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-grounding-'));
    corePath = join(dir, 'core.md');
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports an ungrounded persona and a null band when nothing is present', async () => {
    const { grounding } = await setup();
    const result = await grounding.evaluate();
    expect(result).toMatchObject({
      coreLoaded: false,
      identityGrounded: false,
      userKnown: false,
      relationshipCurrent: false,
      needsWarmup: true,
    });
    expect(result.details.join(' ')).toMatch(/core persona/i);
    expect(await grounding.band()).toBeNull();
  });

  it('is fully grounded with core, identity, user, and a fresh relationship', async () => {
    const { repository, grounding } = await setup({ core: CORE });
    await repository.createRecord({
      userId: 'user',
      category: 'self',
      content: 'I am careful and grounded.',
      source: 'seed:core',
    });
    await repository.upsertUserFact({
      userId: 'user',
      content: 'Rob prefers candor.',
      source: 'chat',
    });
    await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 0.8,
      emotionalTemperature: 0.2,
    });

    const result = await grounding.evaluate();
    expect(result).toMatchObject({
      coreLoaded: true,
      identityGrounded: true,
      userKnown: true,
      relationshipCurrent: true,
      overallScore: 1,
      needsWarmup: false,
    });

    const band = await grounding.band();
    expect(band).toContain('<persona_grounding');
    expect(band).toContain('immutable=true');
    expect(band).toContain('Rob prefers candor.');
  });

  it('lowers the score for a stale relationship', async () => {
    const { repository, grounding } = await setup({ core: CORE });
    await repository.createRecord({
      userId: 'user',
      category: 'self',
      content: 'I am careful and grounded.',
      source: 'seed:core',
    });
    await repository.upsertUserFact({
      userId: 'user',
      content: 'Rob prefers candor.',
      source: 'chat',
    });
    await repository.upsertRelationship({
      userId: 'user',
      trustLevel: 0.8,
      emotionalTemperature: 0,
      occurredAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    });

    const result = await grounding.evaluate();
    expect(result.relationshipCurrent).toBe(false);
    expect(result.overallScore).toBe(0.8);
  });

  it('places core entries first and marks them immutable', async () => {
    const { repository, grounding } = await setup({ core: CORE });
    await repository.createRecord({
      userId: 'user',
      category: 'value',
      content: 'A curated value.',
      protected: true,
      source: 'review',
    });
    const bundle = await grounding.build();
    expect(bundle.entries[0]).toMatchObject({
      layer: 'core',
      immutable: true,
    });
    expect(bundle.entries.some((entry) => entry.layer === 'identity')).toBe(
      true,
    );
  });

  it('truncates to the configured entry limit', async () => {
    const { repository, grounding } = await setup({
      core: CORE,
      configOverride: { personaGroundingEntryLimit: 1 },
    });
    await repository.createRecord({
      userId: 'user',
      category: 'value',
      content: 'A curated value.',
      source: 'review',
    });
    const bundle = await grounding.build();
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.truncated).toBe(true);
  });
});
