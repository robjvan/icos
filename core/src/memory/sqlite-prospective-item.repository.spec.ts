import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import type { NewProspectiveItem, ProspectiveOption } from './prospective-item';
import { SqliteProspectiveItemRepository } from './sqlite-prospective-item.repository';

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

const option = (
  object: string,
  claimId: string,
  origin: 'user' | 'agent' = 'user',
  confidence = 0.9,
): ProspectiveOption => ({ object, origin, confidence, claimId });

const item = (contestCount = 1): NewProspectiveItem => ({
  subject: 'user',
  predicate: 'prefers',
  options: [option('TypeScript', 'claim-a'), option('Rust', 'claim-b')],
  contestCount,
  trigger: 'confidence_drop',
  suggestedQuestion: 'Which should be kept?',
});

describe('SqliteProspectiveItemRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (
    name = 'prospective.sqlite',
  ): SqliteProspectiveItemRepository => {
    const service = new MemoryDatabaseService(testConfig(join(dir, name), dir));
    service.onModuleInit();
    services.push(service);
    return new SqliteProspectiveItemRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-prosp-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates open items with options intact', async () => {
    const repository = openRepo();

    const saved = await repository.create(item());

    expect(saved.id).toBeDefined();
    expect(saved).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
      status: 'open',
      contestCount: 1,
      trigger: 'confidence_drop',
      suggestedQuestion: 'Which should be kept?',
    });
    expect(saved.options).toHaveLength(2);
    expect((await repository.getItem(saved.id))?.id).toBe(saved.id);
    expect(await repository.getItem('missing')).toBeNull();
  });

  it('finds the open row by normalized subject+predicate', async () => {
    const repository = openRepo();
    const saved = await repository.create(item());

    expect(
      (await repository.findOpenBySubjectPredicate('USER', 'Prefers'))?.id,
    ).toBe(saved.id);
    expect(
      await repository.findOpenBySubjectPredicate('user', 'likes'),
    ).toBeNull();
  });

  it('merges repeat contests without duplicating options', async () => {
    const repository = openRepo();
    const saved = await repository.create(item());

    const merged = await repository.mergeContest(
      saved.id,
      [option('Rust', 'claim-b'), option('Go', 'claim-c')],
      'repeated_contest',
      'Which of the three?',
    );

    expect(merged?.contestCount).toBe(2);
    expect(merged?.trigger).toBe('repeated_contest');
    expect(merged?.suggestedQuestion).toBe('Which of the three?');
    expect(merged?.options.map((entry) => entry.claimId)).toEqual([
      'claim-a',
      'claim-b',
      'claim-c',
    ]);
    expect(
      await repository.mergeContest('missing', [], 'repeated_contest', 'q'),
    ).toBeNull();
  });

  it('lists newest-first, defaulting to open', async () => {
    const repository = openRepo();
    await repository.create({ ...item(), predicate: 'likes' });
    await repository.create(item());

    expect(
      (await repository.listItems()).map((entry) => entry.predicate),
    ).toEqual(['prefers', 'likes']);
    expect(await repository.listItems({ status: 'open' })).toHaveLength(2);
    expect(await repository.listItems({ status: 'dismissed' })).toHaveLength(0);
    expect(await repository.listItems({ limit: 1 })).toHaveLength(1);
  });

  it('persists across close and reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const firstService = new MemoryDatabaseService(testConfig(path, dir));
    firstService.onModuleInit();
    const repo = new SqliteProspectiveItemRepository(firstService);
    await repo.create(item(2));
    firstService.onModuleDestroy();

    const secondService = new MemoryDatabaseService(testConfig(path, dir));
    secondService.onModuleInit();
    services.push(secondService);
    const reopened = new SqliteProspectiveItemRepository(secondService);
    const listed = await reopened.listItems();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ contestCount: 2, status: 'open' });
  });

  it('closes open questions with a recorded outcome, terminally', async () => {
    const repository = openRepo();
    const saved = await repository.create(item());

    const resolved = await repository.resolve(saved.id, 'confirmed');
    expect(resolved).toMatchObject({
      status: 'dismissed',
      resolution: 'confirmed',
    });
    expect(resolved?.resolvedAt).toBeDefined();
    expect(resolved?.suggestedQuestion).toBe('Which should be kept?');
    expect(
      (await repository.listItems({ status: 'dismissed' })).map(
        (entry) => entry.id,
      ),
    ).toEqual([saved.id]);
    expect(await repository.listItems({ status: 'open' })).toHaveLength(0);

    // Closing is terminal: no re-resolve, no unknown outcomes, no ghosts.
    expect(await repository.resolve(saved.id, 'corrected')).toBeNull();
    expect(await repository.resolve('missing', 'confirmed')).toBeNull();
    expect(
      await repository.resolve(saved.id, 'whatever' as 'confirmed'),
    ).toBeNull();
  });
});
