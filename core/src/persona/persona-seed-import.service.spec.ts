import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { PersonaDatabaseService } from './persona-database.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';
import { PersonaSeedImportService } from './persona-seed-import.service';

const SEED = [
  '# Mira',
  '',
  '## Core Values',
  '- Clarity over cleverness.',
  '',
  '## Boundaries',
  '- Do not pretend to certainty.',
  '',
  '## Current Self',
  'I am a careful, grounded assistant.',
].join('\n');

function testConfig(dir: string, seedRoot: string): CoreConfig {
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
    personaSeedRoot: seedRoot,
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

describe('PersonaSeedImportService', () => {
  let dir = '';
  let seedRoot = '';
  const services: DatabaseService[] = [];

  const open = (config = testConfig(dir, seedRoot)) => {
    const db = new PersonaDatabaseService(config);
    db.onModuleInit();
    services.push(db);
    const repository = new SqlitePersonaRepository(db);
    const service = new PersonaSeedImportService(config, repository);
    return { repository, service, config };
  };

  const seedFile = (name: string, content: string): string => {
    writeFileSync(join(seedRoot, name), content);
    return name;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-seed-'));
    seedRoot = join(dir, 'seeds');
    mkdirSync(seedRoot, { recursive: true });
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports a persona seed into the evolving tier', async () => {
    seedFile('mira.md', SEED);
    const { repository, service } = open();

    const result = await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    const records = await repository.listRecords('user');
    expect(records).toHaveLength(3);
    const boundary = records.find((record) => record.category === 'boundary');
    expect(boundary).toMatchObject({
      protected: true,
      sensitivity: 'protected',
    });
    expect(boundary?.metadata).toMatchObject({
      seeded: true,
      seedLayer: 'soul_seed',
    });
  });

  it('is idempotent by content hash', async () => {
    seedFile('mira.md', SEED);
    const { service } = open();

    await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });
    const second = await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });

    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);
  });

  it('writes nothing on a dry run', async () => {
    seedFile('mira.md', SEED);
    const { repository, service } = open();

    const result = await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
      dryRun: true,
    });

    expect(result.created).toBe(3);
    expect(await repository.listRecords('user')).toHaveLength(0);
  });

  it('updates only an untouched seeded baseline when the seed changes', async () => {
    seedFile('mira.md', SEED);
    const { repository, service } = open();
    await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });

    seedFile('mira.md', SEED.replace('grounded assistant', 'grounded partner'));
    const result = await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });

    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(2);
    const self = (await repository.listRecords('user')).find(
      (record) => record.category === 'self',
    );
    expect(self?.content).toContain('grounded partner');
  });

  it('stages a changed seed as a candidate when the record was curated', async () => {
    seedFile('mira.md', SEED);
    const { repository, service } = open();
    await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });

    const boundary = (await repository.listRecords('user')).find(
      (record) => record.category === 'boundary',
    );
    // Simulate a curated edit (review changed the content).
    await repository.createRecord({
      recordId: boundary?.recordId,
      userId: 'user',
      category: 'boundary',
      content: 'A curated boundary that supersedes the seed.',
      protected: true,
      source: 'review',
      reviewedBy: 'rob',
    });

    seedFile('mira.md', SEED.replace('Do not pretend', 'Never pretend'));
    const result = await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });

    expect(result.conflictsStaged).toBe(1);
    const pending = await repository.listPendingCandidates('user');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ proposedTarget: 'persona_record' });
    expect(pending[0].metadata).toMatchObject({
      seedUpdate: true,
      conflictsWithProtectedAnchor: true,
    });
    // The curated content is untouched.
    const after = (await repository.listRecords('user')).find(
      (record) => record.recordId === boundary?.recordId,
    );
    expect(after?.content).toBe('A curated boundary that supersedes the seed.');
  });

  it('skips template placeholders', async () => {
    seedFile('mira.md', '## Core Values\n- [value 1]\n- A real value here.');
    const { repository, service } = open();
    const result = await service.import({
      userId: 'user',
      agentId: 'mira',
      reviewedBy: 'rob',
      sources: [{ path: 'mira.md', kind: 'persona' }],
    });
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
    expect(await repository.listRecords('user')).toHaveLength(1);
  });

  it('rejects path escapes, absolute paths, and non-Markdown sources', async () => {
    writeFileSync(join(dir, 'outside.md'), '## Core Values\n- Escaped value.');
    seedFile('mira.md', SEED);
    const { service } = open();
    const base = { userId: 'user', agentId: 'mira', reviewedBy: 'rob' };

    await expect(
      service.import({
        ...base,
        sources: [{ path: '../outside.md', kind: 'persona' }],
      }),
    ).rejects.toThrow(/escapes/);
    await expect(
      service.import({
        ...base,
        sources: [{ path: '/etc/anything.md', kind: 'persona' }],
      }),
    ).rejects.toThrow(/relative/);
    await expect(
      service.import({
        ...base,
        sources: [{ path: 'mira.txt', kind: 'persona' }],
      }),
    ).rejects.toThrow(/Markdown/);
  });

  it('rejects a missing seed root', async () => {
    const config = testConfig(dir, join(dir, 'does-not-exist'));
    const { service } = open(config);
    await expect(
      service.import({
        userId: 'user',
        agentId: 'mira',
        reviewedBy: 'rob',
        sources: [{ path: 'mira.md', kind: 'persona' }],
      }),
    ).rejects.toThrow(/seed root/);
  });
});
