import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { AssociativeRecall } from './associative-recall';
import { ClaimIndex, ClaimIndexUnavailableError } from './claim-index';
import type { SimilarClaim } from './claim-index';
import { KbBridge, NullKbBridge } from './kb-bridge';
import type { NewClaim } from './claim';
import { MemoryDatabaseService } from './memory-database.service';
import { RecallService } from './recall.service';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqliteLexicalClaimIndex } from './sqlite-lexical-claim-index';

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
const claim = (
  subject: string,
  predicate: string,
  object: string,
): NewClaim => {
  counter += 1;
  return {
    subject,
    predicate,
    object,
    category: 'fact',
    status: 'active',
    extractorConfidence: 0.9,
    confidence: 0.9,
    firstAssertedAt: `cand-${counter}`,
    lastSurfacedAt: `cand-${counter}`,
    origin: 'user',
    negated: false,
    evidence: [{ candidateId: `cand-${counter}`, role: 'user' }],
    entities: [subject],
    promotion: 'approved:appr-1',
  };
};

const stubIndex = (hits: SimilarClaim[] = []): ClaimIndex => ({
  indexClaim: jest.fn(() => Promise.resolve()),
  searchSimilar: jest.fn(() => Promise.resolve(hits)),
  status: jest.fn(() => Promise.resolve({ enabled: true })),
});

describe('RecallService', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = (semantic: ClaimIndex = stubIndex()) => {
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'recall.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    const kb: KbBridge = new NullKbBridge();
    const recall = new RecallService(
      new SqliteLexicalClaimIndex(service),
      semantic,
      new AssociativeRecall(claims),
      kb,
    );
    return { claims, recall };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-recall-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('fans out with per-surface identity on every hit', async () => {
    const s = setup(stubIndex([{ claimId: 'semantic-1', score: 0.2 }]));
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );

    const result = await s.recall.recall('user prefers TypeScript', 5);
    expect(result.lexical.available).toBe(true);
    expect(
      result.lexical.hits.map((hit) => [hit.claimId, hit.surface]),
    ).toEqual([[saved.id, 'lexical']]);
    expect(result.semantic.hits).toMatchObject([
      { claimId: 'semantic-1', surface: 'semantic' },
    ]);
    expect(result.associative.hits.map((hit) => hit.surface)).toContain(
      'associative',
    );
    expect(result.query.tokens).toContain('typescript');
  });

  it('isolates a dead semantic surface without blocking the rest', async () => {
    const dead = {
      indexClaim: jest.fn(() => Promise.resolve()),
      searchSimilar: jest.fn(() =>
        Promise.reject(
          new ClaimIndexUnavailableError('native backend missing'),
        ),
      ),
      status: jest.fn(() => Promise.resolve({ enabled: false })),
    } as unknown as ClaimIndex;
    const s = setup(dead);
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );

    const result = await s.recall.recall('user prefers TypeScript', 5);
    expect(result.semantic).toMatchObject({
      available: false,
      reason: 'index_unavailable',
      hits: [],
    });
    expect(result.lexical.available).toBe(true);
    expect(result.lexical.hits.map((hit) => hit.claimId)).toEqual([saved.id]);
    expect(result.associative.available).toBe(true);
  });

  it('reports empty queries per surface and flags the absent KB', async () => {
    const s = setup();
    await s.claims.createClaim(claim('user', 'prefers', 'TypeScript'));

    const result = await s.recall.recall('   ', 5);
    expect(result.query).toMatchObject({ text: '', tokens: [] });
    for (const surface of [
      result.lexical,
      result.semantic,
      result.associative,
    ]) {
      expect(surface.available).toBe(false);
      expect(surface.hits).toEqual([]);
    }
    // No corpus behind the bridge: absent, flagged — never failed.
    expect(result.kb).toEqual({ available: false, hits: [] });
  });

  it('reaches by resonance what neither phrase nor vector catches', async () => {
    // Seeded M11f scenario: "favourite" appears nowhere in the
    // triple, the (mocked) vector surface stays silent, yet the
    // shared "user" token resonates.
    const s = setup(stubIndex([]));
    const target = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    await s.claims.createClaim(claim('project', 'uses', 'Rust'));

    const result = await s.recall.recall('user favourite language', 5);
    expect(result.lexical.hits).toEqual([]);
    expect(result.semantic.hits).toEqual([]);
    expect(result.associative.hits.map((hit) => hit.claimId)).toEqual([
      target.id,
    ]);
  });

  it('never throws when every surface is down', async () => {
    const failing = {
      indexClaim: jest.fn(() => Promise.resolve()),
      searchSimilar: jest.fn(() => Promise.reject(new Error('boom'))),
      status: jest.fn(() => Promise.resolve({ enabled: false })),
    } as unknown as ClaimIndex;
    const broken = {
      searchLexical: jest.fn(() => Promise.reject(new Error('fts down'))),
      ping: jest.fn(() => Promise.resolve()),
    };
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'broken.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    const recall = new RecallService(
      broken as unknown as SqliteLexicalClaimIndex,
      failing,
      new AssociativeRecall(new SqliteClaimRepository(service)),
      new NullKbBridge(),
    );

    const result = await recall.recall('user prefers TypeScript', 5);
    expect(result.lexical.available).toBe(false);
    expect(result.semantic.available).toBe(false);
    expect(result.associative.available).toBe(true);
    expect(result.kb.available).toBe(false);
  });
});
