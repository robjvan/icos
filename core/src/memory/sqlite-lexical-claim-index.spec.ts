import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import type { NewClaim } from './claim';
import { MemoryDatabaseService } from './memory-database.service';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqliteLexicalClaimIndex } from './sqlite-lexical-claim-index';

function testConfig(memoryDbPath: string, dir: string): CoreConfig {
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

describe('SqliteLexicalClaimIndex', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = () => {
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'lex.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    return {
      claims: new SqliteClaimRepository(service),
      lexical: new SqliteLexicalClaimIndex(service),
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-lex-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('recalls exact triples before falling back to token-AND', async () => {
    const s = setup();
    const ts = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    await s.claims.createClaim(claim('user', 'prefers', 'Rust'));

    const exact = await s.lexical.searchLexical('user prefers TypeScript', 5);
    expect(exact.map((hit) => hit.claimId)).toEqual([ts.id]);

    // No phrase matches; token-AND still finds both contenders.
    const broad = await s.lexical.searchLexical('user prefers', 5);
    expect(broad).toHaveLength(2);
  });

  it('never crashes on FTS syntax characters (hyphen lesson)', async () => {
    const s = setup();
    const saved = await s.claims.createClaim(
      claim('user', 'working_on', 'well-being'),
    );

    for (const hostile of [
      'well-being',
      '"unbalanced quote',
      'star* caret^ parens() column:foo',
      'OR AND NOT NEAR("x", "y")',
      '---',
    ]) {
      await expect(s.lexical.searchLexical(hostile, 5)).resolves.toBeDefined();
    }
    // The hyphenated term still tokenizes into a hit.
    const hits = await s.lexical.searchLexical('well-being', 5);
    expect(hits.map((hit) => hit.claimId)).toEqual([saved.id]);
  });

  it('returns nothing for empty or stopword-only input', async () => {
    const s = setup();
    await s.claims.createClaim(claim('user', 'prefers', 'TypeScript'));

    expect(await s.lexical.searchLexical('', 5)).toEqual([]);
    expect(await s.lexical.searchLexical('!!!', 5)).toEqual([]);
  });

  it('indexes claims written before the surface existed', async () => {
    const path = join(dir, 'aged.sqlite');
    const first = new MemoryDatabaseService(testConfig(path, dir));
    first.onModuleInit();
    // Age the file: drop the FTS surface the way a pre-M11a file looks
    // (no table, no triggers — claims land without index writes).
    first.connection.exec(
      `DROP TABLE claims_fts;
       DROP TRIGGER IF EXISTS claims_ai;
       DROP TRIGGER IF EXISTS claims_ad;
       DROP TRIGGER IF EXISTS claims_au;`,
    );
    const repo = new SqliteClaimRepository(first);
    const saved = await repo.createClaim(claim('user', 'prefers', 'Go'));
    first.onModuleDestroy();

    // Reopen: migration rebuilds the index from the content table.
    const second = new MemoryDatabaseService(testConfig(path, dir));
    second.onModuleInit();
    services.push(second);
    const lexical = new SqliteLexicalClaimIndex(second);
    const hits = await lexical.searchLexical('user prefers Go', 5);
    expect(hits.map((hit) => hit.claimId)).toEqual([saved.id]);
  });
});
