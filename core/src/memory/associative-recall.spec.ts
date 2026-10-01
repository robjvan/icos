import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import type { Claim } from './claim';
import type { NewClaim } from './claim';
import { MemoryDatabaseService } from './memory-database.service';
import {
  AssociativeRecall,
  resonanceScore,
  resonanceText,
} from './associative-recall';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { tokenize } from './text-tokens';

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

let counter = 0;
const claim = (
  subject: string,
  predicate: string,
  object: string,
  extra: Partial<NewClaim> = {},
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
    ...extra,
  };
};

describe('resonanceScore', () => {
  it('weights exact overlap full, prefix-partial half', () => {
    expect(resonanceScore(['user', 'prefers'], ['user', 'prefers'])).toBe(2);
    expect(resonanceScore(['prefer'], ['prefers'])).toBe(0.5);
    expect(resonanceScore(['prefers'], ['prefer'])).toBe(0.5);
    expect(resonanceScore(['rust'], ['typescript'])).toBe(0);
  });

  it('ignores short-token partials and dedupes query repeats', () => {
    expect(resonanceScore(['go'], ['goal'])).toBe(0);
    expect(resonanceScore(['user', 'user'], ['user'])).toBe(1);
  });

  it('never scores on stopwords or negation-stripped input', () => {
    // Tokenizer drops stopwords but keeps every negation word.
    expect(tokenize('the user is not happy')).toEqual(['user', 'not', 'happy']);
  });
});

describe('AssociativeRecall', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = () => {
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'assoc.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    return { claims, recall: new AssociativeRecall(claims) };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-assoc-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('reaches claims by resonance where lexical has no phrase', async () => {
    const s = setup();
    // "favourite" never appears in the triple; "user" resonates.
    const target = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    await s.claims.createClaim(claim('project', 'uses', 'Rust'));

    const query = ['user', 'favourite', 'language'];
    const hits = await s.recall.recallAssociative(query, 5);
    expect(hits.map((hit) => hit.claimId)).toEqual([target.id]);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('ranks fuller overlap first and respects k', async () => {
    const s = setup();
    const full = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    const partial = await s.claims.createClaim(claim('user', 'likes', 'tea'));

    const hits = await s.recall.recallAssociative(
      ['user', 'prefers', 'typescript'],
      5,
    );
    expect(hits.map((hit) => hit.claimId)).toEqual([full.id, partial.id]);

    const top = await s.recall.recallAssociative(
      ['user', 'prefers', 'typescript'],
      1,
    );
    expect(top.map((hit) => hit.claimId)).toEqual([full.id]);
  });

  it('returns nothing for empty tokens', async () => {
    const s = setup();
    await s.claims.createClaim(claim('user', 'prefers', 'TypeScript'));
    expect(await s.recall.recallAssociative([], 5)).toEqual([]);
  });

  it('scores entities and triple text together', () => {
    const withEntity = {
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
    } as Claim;
    expect(
      resonanceText({ ...withEntity, entities: ['person:Ada'] }),
    ).toContain('person:Ada');
  });
});
