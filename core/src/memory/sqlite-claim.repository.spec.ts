import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import type { NewClaim } from './claim';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqliteMemoryCandidateRepository } from './sqlite-memory-candidate.repository';

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

const claim = (object = 'TypeScript'): NewClaim => ({
  subject: 'user',
  predicate: 'prefers',
  object,
  category: 'preference',
  status: 'candidate',
  extractorConfidence: 0.9,
  confidence: 0.5,
  firstAssertedAt: 'cand-1',
  lastSurfacedAt: 'cand-1',
  origin: 'user',
  negated: false,
  evidence: [{ candidateId: 'cand-1', role: 'user' }],
  entities: ['user'],
  promotion: 'approved:appr-1',
});

describe('SqliteClaimRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (name = 'claims.sqlite'): SqliteClaimRepository => {
    const service = new MemoryDatabaseService(testConfig(join(dir, name), dir));
    service.onModuleInit();
    services.push(service);
    return new SqliteClaimRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-claim-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates claims with provenance and defaults', async () => {
    const repository = openRepo();

    const saved = await repository.createClaim(claim());

    expect(saved.id).toBeDefined();
    expect(saved).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      category: 'preference',
      status: 'candidate',
      origin: 'user',
      firstAssertedAt: 'cand-1',
      lastSurfacedAt: 'cand-1',
      evidence: [{ candidateId: 'cand-1', role: 'user' }],
    });
    // Reserved fields stay at defaults through M10 paths.
    expect(saved.sourceType).toBeNull();
    expect(saved.summary).toBeNull();
    expect(saved.related).toEqual([]);
    expect(saved.timesObserved).toBe(1);
    expect(saved.accessCount).toBe(0);
    expect(saved.lastAccessedAt).toBeNull();
    expect(saved.activation).toBeNull();
    expect(saved.locked).toBe(false);
    expect(saved.emotional).toBeNull();
  });

  it('refuses duplicate identity instead of forking a claim', async () => {
    const repository = openRepo();
    await repository.createClaim(claim());

    await expect(
      repository.createClaim({
        ...claim(),
        object: '  TYPESCRIPT ',
        promotion: 'approved:appr-2',
      }),
    ).rejects.toThrow('already exists');
  });

  it('finds claims by normalized triple', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const found = await repository.findByTriple({
      subject: ' User ',
      predicate: 'PREFERS',
      object: 'typescript',
    });
    expect(found?.id).toBe(saved.id);
    expect(
      await repository.findByTriple({
        subject: 'user',
        predicate: 'prefers',
        object: 'Rust',
      }),
    ).toBeNull();
  });

  it('appends evidence without rewriting origin or first assertion', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const updated = await repository.appendEvidence(
      saved.id,
      [{ candidateId: 'cand-2', role: 'assistant' }],
      0.7,
    );

    expect(updated?.evidence).toEqual([
      { candidateId: 'cand-1', role: 'user' },
      { candidateId: 'cand-2', role: 'assistant' },
    ]);
    expect(updated?.lastSurfacedAt).toBe('cand-2');
    expect(updated?.firstAssertedAt).toBe('cand-1');
    expect(updated?.origin).toBe('user');
    expect(updated?.timesObserved).toBe(2);
    expect(updated?.confidence).toBe(0.7);
  });

  it('ignores already-attached evidence on re-append', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const updated = await repository.appendEvidence(
      saved.id,
      [{ candidateId: 'cand-1', role: 'user' }],
      0.6,
    );
    expect(updated?.evidence).toHaveLength(1);
  });

  it('enforces the status lifecycle', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    // candidate → contradicted is illegal (must promote first).
    expect(await repository.setStatus(saved.id, 'contradicted')).toBeNull();
    expect((await repository.getClaim(saved.id))?.status).toBe('candidate');

    expect((await repository.setStatus(saved.id, 'active'))?.status).toBe(
      'active',
    );
    // active → candidate is illegal (no resurrection).
    expect(await repository.setStatus(saved.id, 'candidate')).toBeNull();

    expect((await repository.setStatus(saved.id, 'contradicted'))?.status).toBe(
      'contradicted',
    );
    expect(await repository.setStatus('missing', 'active')).toBeNull();
  });

  it('finds conflicts by subject+predicate regardless of object', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());
    await repository.createClaim(claim('Rust'));

    const conflicts = await repository.findBySubjectPredicate(
      'USER',
      'prefers',
    );
    expect(conflicts.map((c) => c.object).sort()).toEqual([
      'Rust',
      'TypeScript',
    ]);
    expect(
      await repository.findBySubjectPredicate('user', 'likes'),
    ).toHaveLength(0);
    expect(conflicts[0]?.id).toBeDefined();
    expect(saved.id).toBeDefined();
  });

  it('lists newest-first, optionally filtered by status', async () => {
    const repository = openRepo();
    const a = await repository.createClaim(claim('A'));
    await repository.createClaim(claim('B'));
    await repository.setStatus(a.id, 'active');

    expect((await repository.listClaims()).map((c) => c.object)).toEqual([
      'B',
      'A',
    ]);
    expect(
      (await repository.listClaims({ status: 'active' })).map((c) => c.object),
    ).toEqual(['A']);
  });

  it('filters by category and origin', async () => {
    const repository = openRepo();
    await repository.createClaim(claim('A'));
    await repository.createClaim({
      ...claim('B'),
      subject: 'system',
      predicate: 'runs_on',
      category: 'fact',
      origin: 'agent',
      evidence: [{ candidateId: 'cand-9', role: 'assistant' }],
    });

    expect(
      (await repository.listClaims({ category: 'fact' })).map((c) => c.object),
    ).toEqual(['B']);
    expect(
      (await repository.listClaims({ origin: 'agent' })).map((c) => c.object),
    ).toEqual(['B']);
    expect(
      (
        await repository.listClaims({ category: 'preference', origin: 'user' })
      ).map((c) => c.object),
    ).toEqual(['A']);
  });

  it('persists claims and ledger-touch-free status across reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const firstService = new MemoryDatabaseService(testConfig(path, dir));
    firstService.onModuleInit();
    const repo = new SqliteClaimRepository(firstService);
    const saved = await repo.createClaim(claim());
    await repo.setStatus(saved.id, 'active');
    firstService.onModuleDestroy();

    const secondService = new MemoryDatabaseService(testConfig(path, dir));
    secondService.onModuleInit();
    services.push(secondService);
    const reopened = new SqliteClaimRepository(secondService);
    const listed = await reopened.listClaims({ status: 'active' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ object: 'TypeScript', origin: 'user' });
  });

  it('observes access without touching beliefs', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());
    expect(saved.accessCount).toBe(0);
    expect(saved.lastAccessedAt).toBeNull();

    await repository.recordAccessed([saved.id, 'missing']);
    const observed = await repository.getClaim(saved.id);
    expect(observed?.accessCount).toBe(1);
    expect(observed?.lastAccessedAt).toBeDefined();
    // Belief fields untouched by observation.
    expect(observed).toMatchObject({
      object: 'TypeScript',
      confidence: 0.5,
      status: 'candidate',
      timesObserved: 1,
    });

    // One bump per call even with repeats; empty is a no-op.
    await repository.recordAccessed([saved.id, saved.id]);
    expect((await repository.getClaim(saved.id))?.accessCount).toBe(2);
    await repository.recordAccessed([]);
  });

  it('adjusts engine confidence without touching lifecycle or provenance', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const updated = await repository.adjustConfidence(saved.id, 0.96);
    expect(updated?.confidence).toBe(0.96);
    expect(updated).toMatchObject({
      status: 'candidate',
      origin: 'user',
      firstAssertedAt: 'cand-1',
      extractorConfidence: 0.9,
    });
    expect(await repository.adjustConfidence('missing', 0.5)).toBeNull();
  });

  it('appends related ids deduped, never self-linked', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const linked = await repository.addRelated(saved.id, ['b', 'c', 'b']);
    expect(linked?.related).toEqual(['b', 'c']);
    const relinked = await repository.addRelated(saved.id, [
      'c',
      'd',
      saved.id,
    ]);
    expect(relinked?.related).toEqual(['b', 'c', 'd']);
    expect(await repository.addRelated('missing', ['b'])).toBeNull();
  });

  it('freezes and releases the certainty lock', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());
    expect(saved.locked).toBe(false);

    expect((await repository.setLocked(saved.id, true))?.locked).toBe(true);
    expect((await repository.getClaim(saved.id))?.locked).toBe(true);
    expect((await repository.setLocked(saved.id, false))?.locked).toBe(false);
    expect(await repository.setLocked('missing', true)).toBeNull();
  });

  it('stamps the source type once read', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());
    expect(saved.sourceType).toBeNull();

    expect(
      (await repository.setSourceType(saved.id, 'direct_statement'))
        ?.sourceType,
    ).toBe('direct_statement');
    expect(await repository.setSourceType('missing', 'x')).toBeNull();
  });

  it('coexists affirmed and negated rivals under one triple', async () => {
    const repository = openRepo();
    const affirmed = await repository.createClaim(claim());
    const negated = await repository.createClaim({
      ...claim(),
      negated: true,
      promotion: 'approved:appr-2',
    });

    expect(affirmed.id).not.toBe(negated.id);
    expect(negated.negated).toBe(true);
    expect(
      (
        await repository.findByTriple({
          subject: 'user',
          predicate: 'prefers',
          object: 'TypeScript',
        })
      )?.id,
    ).toBe(affirmed.id);
    expect(
      (
        await repository.findByTriple({
          subject: 'user',
          predicate: 'prefers',
          object: 'TypeScript',
          negated: true,
        })
      )?.id,
    ).toBe(negated.id);
  });

  it('still refuses same-marker duplicates', async () => {
    const repository = openRepo();
    await repository.createClaim({ ...claim(), negated: true });

    await expect(
      repository.createClaim({ ...claim(), negated: true }),
    ).rejects.toThrow('already exists');
  });

  it('migrates pre-marker claim files without losing rows', async () => {
    const path = join(dir, 'legacy.sqlite');
    const legacy = new MemoryDatabaseService(testConfig(path, dir));
    legacy.onModuleInit();
    const legacyRepo = new SqliteClaimRepository(legacy);
    const saved = await legacyRepo.createClaim(claim());
    // Simulate the pre-M10e file shape: no marker column, unique on
    // identity_key alone. Row data is preserved; only the shape ages.
    legacy.connection.exec(
      `DROP INDEX idx_claims_identity;
       ALTER TABLE claims DROP COLUMN negated;
       CREATE UNIQUE INDEX idx_claims_identity ON claims(identity_key);`,
    );
    legacy.onModuleDestroy();

    // Reopen through the migration: marker backfilled as affirmed,
    // index rebuilt composite, old rows intact.
    const migrated = new MemoryDatabaseService(testConfig(path, dir));
    migrated.onModuleInit();
    services.push(migrated);
    const reopened = new SqliteClaimRepository(migrated);
    expect((await reopened.getClaim(saved.id))?.negated).toBe(false);
    // And the affirmed row still converges by triple.
    expect(
      (
        await reopened.findByTriple({
          subject: 'user',
          predicate: 'prefers',
          object: 'TypeScript',
        })
      )?.id,
    ).toBe(saved.id);
  });

  it('queries the timeline by window and conversation', async () => {
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'timeline.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    const repository = new SqliteClaimRepository(service);
    const old = await repository.createClaim(claim('Old'));
    await repository.createClaim(claim('Young'));
    // Backdate through the table: creation time is stamped at write.
    service.connection
      .prepare('UPDATE claims SET created_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', old.id);

    expect(
      (await repository.listClaimsByTime({})).map((c) => c.object),
    ).toEqual(['Young', 'Old']);
    expect(
      (
        await repository.listClaimsByTime({
          from: '2025-01-01T00:00:00.000Z',
        })
      ).map((c) => c.object),
    ).toEqual(['Young']);
    expect(
      await repository.listClaimsByTime({
        from: '2021-01-01T00:00:00.000Z',
        to: '2022-01-01T00:00:00.000Z',
      }),
    ).toHaveLength(0);
    expect(await repository.listClaimsByTime({ limit: 1 })).toHaveLength(1);
  });

  it('scopes the timeline to one conversation via evidence', async () => {
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'timeline-sess.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    const candidates = new SqliteMemoryCandidateRepository(service);
    const repository = new SqliteClaimRepository(service);
    const save = async (sessionId: string, object: string): Promise<string> => {
      const [saved] = await candidates.saveCandidates([
        {
          kind: 'fact',
          subject: 'user',
          predicate: 'likes',
          object,
          confidence: 0.9,
          importance: 0.5,
          stability: 0.5,
          sourceRole: 'user',
          source: { sessionId, messageId: 1, role: 'user' },
          extractorModel: 'mem',
          extractorVersion: 'v1',
          negated: false,
        },
      ]);
      if (!saved) throw new Error('seed failed');
      const created = await repository.createClaim({
        ...claim(object),
        subject: 'user',
        predicate: 'likes',
        evidence: [{ candidateId: saved.id, role: 'user' }],
      });
      return created.id;
    };
    const inSession = await save('s1', 'tea');
    await save('s2', 'coffee');

    expect(
      (await repository.listClaimsByTime({ sessionId: 's1' })).map((c) => c.id),
    ).toEqual([inSession]);
    expect(
      await repository.listClaimsByTime({ sessionId: 'nope' }),
    ).toHaveLength(0);
  });
});
