import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import type { Claim } from './claim';
import type { NewClaim } from './claim';
import { compoundConfidence, MaintenanceService } from './maintenance.service';
import {
  decayStep,
  retireEligibility,
  RetirementIneligibleError,
} from './maintenance.service';
import { MemoryDatabaseService } from './memory-database.service';
import { PromotionJournalRepository } from './promotion-journal.repository';
import { SqliteClaimHistoryRepository } from './sqlite-claim-history.repository';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqlitePromotionJournalRepository } from './sqlite-promotion-journal.repository';

function testConfig(
  memoryDbPath: string,
  dir: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
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
    memoryMaintenanceEnabled: false,
    memoryMaintenanceIntervalMs: 3600000,
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
    ...overrides,
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

describe('compoundConfidence', () => {
  it('scales with corroboration, capped below one', () => {
    // +0.02 × min(5, timesObserved), ceiling 0.99, hard max 1.
    expect(compoundConfidence(0.9, 1)).toBeCloseTo(0.92, 6);
    expect(compoundConfidence(0.9, 3)).toBeCloseTo(0.96, 6);
    expect(compoundConfidence(0.9, 99)).toBeCloseTo(0.99, 6);
    expect(compoundConfidence(0.985, 5)).toBe(0.99);
    expect(compoundConfidence(0.99, 5)).toBe(0.99);
  });
});

describe('MaintenanceService', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'maint.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    const history = new SqliteClaimHistoryRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
    );
    return { maintenance, claims, history, journal, config };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-maint-'));
    counter = 0;
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const freshClaim = async (
    setupResult: ReturnType<typeof setup>,
    subject = 'user',
    predicate = 'prefers',
    object = 'TypeScript',
    extra: Partial<NewClaim> = {},
  ): Promise<Claim> =>
    setupResult.claims.createClaim(claim(subject, predicate, object, extra));

  it('compounds unapplied corroboration exactly once', async () => {
    const s = setup();
    const saved = await freshClaim(s, 'user', 'prefers', 'TypeScript', {
      evidence: [
        { candidateId: 'c1', role: 'user' },
        { candidateId: 'c2', role: 'user' },
        { candidateId: 'c3', role: 'user' },
      ],
    });
    // timesObserved only moves through REINFORCE; simulate it here.
    const reinforced = await s.claims.appendEvidence(
      saved.id,
      [{ candidateId: 'c4', role: 'user' }],
      0.9,
    );

    expect(await s.maintenance.runPass()).toMatchObject({
      compounded: 1,
      skipped: 0,
    });
    // 0.9 + 0.02 × min(5, 2 observed) — appendEvidence bumped the counter.
    expect((await s.claims.getClaim(saved.id))?.confidence).toBeCloseTo(
      0.94,
      6,
    );
    expect(await s.history.listByClaimId(saved.id)).toMatchObject([
      { transition: 'compound' },
    ]);

    // Second pass converges: nothing new to apply.
    expect(await s.maintenance.runPass()).toMatchObject({
      compounded: 0,
      skipped: 1,
    });
    expect((await s.claims.getClaim(saved.id))?.confidence).toBeCloseTo(
      0.94,
      6,
    );
    expect(reinforced?.timesObserved).toBe(2);
  });

  it('never compounds past the ceiling or a fresh observation gap', async () => {
    const s = setup();
    const high = await freshClaim(s, 'user', 'prefers', 'teal', {
      confidence: 0.985,
      evidence: [
        { candidateId: 'c1', role: 'user' },
        { candidateId: 'c2', role: 'user' },
      ],
    });
    await s.claims.appendEvidence(
      high.id,
      [{ candidateId: 'c9', role: 'user' }],
      0.985,
    );
    const single = await freshClaim(s, 'user', 'likes', 'rain');

    expect(await s.maintenance.runPass()).toMatchObject({
      compounded: 1,
      skipped: 1,
    });
    expect((await s.claims.getClaim(high.id))?.confidence).toBe(0.99);
    // Single-observation claims never compound.
    expect((await s.claims.getClaim(single.id))?.confidence).toBe(0.9);
  });

  it('links contradiction counterparts both ways with history', async () => {
    const s = setup();
    const old = await freshClaim(s, 'user', 'prefers', 'TypeScript');
    const current = await freshClaim(s, 'user', 'prefers', 'Rust');
    await s.claims.setStatus(old.id, 'contradicted');
    // Journal state mirrors a committed CONTRADICT (promotion's shape).
    const proposed = await s.journal.recordProposal({
      candidateId: 'cand-x',
      operation: 'CONTRADICT',
    });
    await s.journal.setState(proposed.id, 'committed', {
      claimId: current.id,
      detail: `contradicts:${old.id}`,
    });

    expect(await s.maintenance.runPass()).toMatchObject({
      linked: 2,
      skipped: 0,
    });
    expect((await s.claims.getClaim(old.id))?.related).toEqual([current.id]);
    expect((await s.claims.getClaim(current.id))?.related).toEqual([old.id]);
    expect(
      (await s.history.listByClaimId(old.id)).map((row) => row.transition),
    ).toEqual(['link']);

    // Idempotent: linked pairs skip on re-pass.
    expect(await s.maintenance.runPass()).toMatchObject({
      linked: 0,
      skipped: 2,
    });
  });

  it('proposes gist families once, never for shared evidence', async () => {
    const s = setup();
    // Three episodes, distinct evidence: a family.
    await freshClaim(s, 'user', 'drinks', 'coffee', {
      evidence: [{ candidateId: 'e1', role: 'user' }],
    });
    await freshClaim(s, 'user', 'drinks', 'tea', {
      evidence: [{ candidateId: 'e2', role: 'user' }],
    });
    await freshClaim(s, 'user', 'drinks', 'water', {
      evidence: [{ candidateId: 'e3', role: 'user' }],
    });
    // Same triple twice (shared derivation, not episodes).
    await freshClaim(s, 'user', 'likes', 'rain', {
      evidence: [{ candidateId: 'e4', role: 'user' }],
    });

    const summary = await s.maintenance.runPass();
    expect(summary.gistProposed).toBe(3);
    const histories = await s.history.listByClaimId(
      (
        await s.claims.findByTriple({
          subject: 'user',
          predicate: 'drinks',
          object: 'coffee',
        })
      )?.id ?? '',
    );
    expect(histories).toMatchObject([{ transition: 'gist_proposed' }]);
    expect(histories[0]?.detail).toMatchObject({
      suggestion: 'user drinks *',
    });

    // Second pass: families already proposed, nothing new.
    expect(await s.maintenance.runPass()).toMatchObject({
      gistProposed: 0,
    });
  });

  it('isolates per-record failure without aborting the pass', async () => {
    const s = setup();
    const reinforced = await freshClaim(s, 'user', 'prefers', 'TypeScript', {
      evidence: [
        { candidateId: 'c1', role: 'user' },
        { candidateId: 'c2', role: 'user' },
      ],
    });
    await s.claims.appendEvidence(
      reinforced.id,
      [{ candidateId: 'c3', role: 'user' }],
      0.9,
    );
    await freshClaim(s, 'user', 'likes', 'rain');
    const failingJournal = {
      listByState: () => Promise.reject(new Error('journal down')),
    } as unknown as PromotionJournalRepository;
    const probing = new MaintenanceService(
      s.config,
      s.claims,
      s.history,
      failingJournal,
    );

    // First claim compounds (before the journal is ever touched);
    // both then fail at linking — counted, never thrown.
    expect(await probing.runPass()).toMatchObject({
      compounded: 1,
      failed: 1,
    });
  });

  it('schedules on cadence when enabled, stays dark when not', async () => {
    jest.useFakeTimers();
    try {
      const on = setup({ memoryMaintenanceEnabled: true });
      const spy = jest.spyOn(on.maintenance, 'runPass').mockResolvedValue({
        compounded: 0,
        decayed: 0,
        linked: 0,
        gistProposed: 0,
        skipped: 0,
        failed: 0,
        durationMs: 0,
      });
      on.maintenance.onModuleInit();
      await jest.advanceTimersByTimeAsync(3_600_000);
      expect(spy).toHaveBeenCalledTimes(1);
      on.maintenance.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(3_600_000 * 2);
      expect(spy).toHaveBeenCalledTimes(1);

      const off = setup({ memoryMaintenanceEnabled: false });
      const quiet = jest.spyOn(off.maintenance, 'runPass').mockResolvedValue({
        compounded: 0,
        decayed: 0,
        linked: 0,
        gistProposed: 0,
        skipped: 0,
        failed: 0,
        durationMs: 0,
      });
      off.maintenance.onModuleInit();
      await jest.advanceTimersByTimeAsync(3_600_000);
      expect(quiet).not.toHaveBeenCalled();
      off.maintenance.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('decayStep', () => {
  const now = Date.parse('2026-09-30T00:00:00.000Z');
  const base = {
    confidence: 0.9,
    category: 'fact' as const,
    locked: false,
    lastAccessedAt: null as string | null,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  it('decays exponentially past grace with category half-lives', () => {
    // 121 days old, 30 grace → 91 effective / 90 half-life ≈ one halving.
    expect(decayStep(base, now, null)).toBeCloseTo(0.45, 2);
    // Preferences fade faster (0.8×), relationships slower (2×).
    const fact = decayStep(base, now, null) ?? 0;
    expect(
      decayStep({ ...base, category: 'preference' }, now, null),
    ).toBeLessThan(fact);
    expect(
      decayStep({ ...base, category: 'relationship' }, now, null),
    ).toBeGreaterThan(fact);
  });

  it('holds grace, floors, locks, and shields', () => {
    // Inside the 30-day grace: no decay.
    expect(
      decayStep({ ...base, updatedAt: '2026-09-15T00:00:00.000Z' }, now, null),
    ).toBeNull();
    // At/below floor: no decay (and never a raise).
    expect(decayStep({ ...base, confidence: 0.2 }, now, null)).toBeNull();
    expect(decayStep({ ...base, confidence: 0.1 }, now, null)).toBeNull();
    // Locked certainty guards loss.
    expect(decayStep({ ...base, locked: true }, now, null)).toBeNull();
    // Access within the shield window protects without strengthening.
    expect(
      decayStep(
        { ...base, lastAccessedAt: '2026-09-28T00:00:00.000Z' },
        now,
        null,
      ),
    ).toBeNull();
    // Old access does not protect.
    expect(
      decayStep(
        { ...base, lastAccessedAt: '2026-01-01T00:00:00.000Z' },
        now,
        null,
      ),
    ).not.toBeNull();
  });

  it('floors instead of deleting on deep neglect', () => {
    const ancient = decayStep(
      { ...base, updatedAt: '2020-01-01T00:00:00.000Z' },
      now,
      null,
    );
    expect(ancient).toBe(0.2);
  });

  it('is idempotent at the same instant (memoryless increments)', () => {
    const first = decayStep(base, now, null);
    expect(first).not.toBeNull();
    // A pass that just decayed re-runs clean: zero elapsed, zero bill.
    expect(
      decayStep(
        { ...base, confidence: first ?? 0 },
        now,
        new Date(now).toISOString(),
      ),
    ).toBeNull();
    // Later instants decay further, converging asymptotically.
    const later = decayStep(
      { ...base, confidence: first ?? 0 },
      now + 30 * 86_400_000,
      new Date(now).toISOString(),
    );
    expect(later).not.toBeNull();
    expect(later ?? 1).toBeLessThan(first ?? 0);
  });
});

describe('retireEligibility', () => {
  const now = Date.parse('2026-09-30T00:00:00.000Z');

  it('requires the long window and low confidence together', () => {
    expect(
      retireEligibility(
        {
          confidence: 0.2,
          lastAccessedAt: null,
          createdAt: '2020-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toMatchObject({ eligible: true });
    expect(
      retireEligibility(
        {
          confidence: 0.2,
          lastAccessedAt: '2026-09-01T00:00:00.000Z',
          createdAt: '2020-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toMatchObject({ eligible: false });
    expect(
      retireEligibility(
        {
          confidence: 0.9,
          lastAccessedAt: null,
          createdAt: '2020-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toMatchObject({ eligible: false });
  });
});

describe('MaintenanceService decay and retirement', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setupDecay = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'decay.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    const history = new SqliteClaimHistoryRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
    );
    return { maintenance, claims, history };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-decay-'));
    counter = 0;
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const DAY_MS = 86_400_000;

  it('decays neglected claims with history, converging on re-pass', async () => {
    const s = setupDecay();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    const future = Date.now() + 200 * DAY_MS;

    expect(await s.maintenance.runPass(future)).toMatchObject({
      decayed: 1,
      skipped: 0,
    });
    // 0.9 × 0.5^((200−30)/90).
    expect((await s.claims.getClaim(saved.id))?.confidence).toBeCloseTo(
      0.9 * Math.pow(0.5, 170 / 90),
      6,
    );
    expect(await s.history.listByClaimId(saved.id)).toMatchObject([
      { transition: 'decay' },
    ]);

    // Later passes keep decaying (wall-clock history rows), strictly
    // decreasing toward the floor — which pins permanently.
    const second = await s.maintenance.runPass(future);
    expect(second).toMatchObject({ decayed: 1 });
    const conf2 = (await s.claims.getClaim(saved.id))?.confidence ?? 1;
    expect(conf2).toBeLessThan(0.9 * Math.pow(0.5, 170 / 90));
    expect(conf2).toBe(0.2);
    // Far future: at floor, further passes skip (converged).
    expect(
      await s.maintenance.runPass(Date.now() + 10_000 * 86_400_000),
    ).toMatchObject({ decayed: 0, skipped: 1 });
    expect((await s.claims.getClaim(saved.id))?.confidence).toBe(0.2);
  });

  it('compounds before decaying (ladder order)', async () => {
    const s = setupDecay();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript', {
        evidence: [
          { candidateId: 'c1', role: 'user' },
          { candidateId: 'c2', role: 'user' },
        ],
      }),
    );
    await s.claims.appendEvidence(
      saved.id,
      [{ candidateId: 'c3', role: 'user' }],
      0.9,
    );
    const future = Date.now() + 200 * DAY_MS;

    // Corroboration outranks neglect: one transition per pass.
    expect(await s.maintenance.runPass(future)).toMatchObject({
      compounded: 1,
      decayed: 0,
    });
  });

  it('retires eligible records explicitly, never silently', async () => {
    const s = setupDecay();
    const old = await s.claims.createClaim(
      claim('user', 'prefers', 'teal', { confidence: 0.2 }),
    );
    const fresh = await s.claims.createClaim(claim('user', 'prefers', 'oak'));
    const future = Date.now() + 200 * DAY_MS;

    const retired = await s.maintenance.retireClaim(old.id, {
      nowMs: future,
    });
    expect(retired?.status).toBe('retired');
    expect(await s.history.listByClaimId(old.id)).toMatchObject([
      { transition: 'retire' },
    ]);
    // Stay queryable with history intact.
    expect(
      (await s.claims.listClaims({ status: 'retired' })).map((c) => c.id),
    ).toEqual([old.id]);

    // Fresh confident claims refuse without force.
    await expect(
      s.maintenance.retireClaim(fresh.id, { nowMs: Date.now() }),
    ).rejects.toBeInstanceOf(RetirementIneligibleError);
    const forced = await s.maintenance.retireClaim(fresh.id, {
      force: true,
    });
    expect(forced?.status).toBe('retired');

    expect(await s.maintenance.retireClaim('missing')).toBeNull();
    // Re-retire is a no-op without history noise.
    const before = await s.history.listByClaimId(old.id);
    expect(
      (await s.maintenance.retireClaim(old.id, { nowMs: future }))?.status,
    ).toBe('retired');
    expect(await s.history.listByClaimId(old.id)).toHaveLength(before.length);
  });
});
