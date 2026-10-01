import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import type { Claim } from './claim';
import type { NewClaim } from './claim';
import { compoundConfidence, MaintenanceService } from './maintenance.service';
import { temporalProximity } from './maintenance';
import {
  activationBoost,
  activationDecayStep,
  spreadShare,
} from './maintenance';
import {
  decayStep,
  pickRevisionWinner,
  retireEligibility,
  RetirementIneligibleError,
} from './maintenance.service';
import { MemoryDatabaseService } from './memory-database.service';
import { PromotionJournalRepository } from './promotion-journal.repository';
import { RecallTraceStore } from './recall-trace.store';
import { SqliteClaimHistoryRepository } from './sqlite-claim-history.repository';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqliteMemoryCandidateRepository } from './sqlite-memory-candidate.repository';
import { SqlitePromotionJournalRepository } from './sqlite-promotion-journal.repository';
import { SqliteProspectiveItemRepository } from './sqlite-prospective-item.repository';
import { SqliteSourceReliabilityRepository } from './sqlite-source-reliability.repository';

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

describe('temporalProximity', () => {
  it('scores co-temporal beliefs near one, distant near zero', () => {
    expect(
      temporalProximity('2026-09-30T00:00:00.000Z', '2026-09-30T12:00:00.000Z'),
    ).toBeCloseTo(0.93, 2);
    expect(
      temporalProximity('2026-09-30T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
    ).toBeLessThan(0.01);
    expect(
      temporalProximity('2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'),
    ).toBe(1);
    expect(temporalProximity('nope', '2026-09-30T00:00:00.000Z')).toBe(0);
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
    const candidates = new SqliteMemoryCandidateRepository(service);
    const reliability = new SqliteSourceReliabilityRepository(service);
    const prospective = new SqliteProspectiveItemRepository(service);
    const traces = new RecallTraceStore();
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
      candidates,
      reliability,
      prospective,
      traces,
    );
    return {
      maintenance,
      claims,
      history,
      journal,
      candidates,
      reliability,
      prospective,
      traces,
      db: service,
      config,
    };
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

    // Second pass converges: nothing new to apply — the claim moves
    // down the ladder to classification (M12c rung, same pass shape).
    expect(await s.maintenance.runPass()).toMatchObject({
      compounded: 0,
      classified: 1,
      skipped: 0,
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
      classified: 1,
      skipped: 0,
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

    // Idempotent: linked pairs skip linking — and move down the
    // ladder to classification on re-pass (M12c rung).
    expect(await s.maintenance.runPass()).toMatchObject({
      linked: 0,
      classified: 2,
      skipped: 0,
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
      s.candidates,
      s.reliability,
      new SqliteProspectiveItemRepository(s.db),
      new RecallTraceStore(),
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
        revised: 0,
        locked: 0,
        classified: 0,
        activated: 0,
        suppressed: 0,
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
        revised: 0,
        locked: 0,
        classified: 0,
        activated: 0,
        suppressed: 0,
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
    const candidates = new SqliteMemoryCandidateRepository(service);
    const reliability = new SqliteSourceReliabilityRepository(service);
    const prospective = new SqliteProspectiveItemRepository(service);
    const traces = new RecallTraceStore();
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
      candidates,
      reliability,
      prospective,
      traces,
    );
    return { maintenance, claims, history, db: service };
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
    // Far future: at floor, decay converges — the claim moves down
    // the ladder to classification (M12c rung).
    expect(
      await s.maintenance.runPass(Date.now() + 10_000 * 86_400_000),
    ).toMatchObject({ decayed: 0, classified: 1, skipped: 0 });
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

describe('pickRevisionWinner', () => {
  const base: Claim = {
    id: 'claim-0',
    subject: 'user',
    predicate: 'prefers',
    object: 'X',
    category: 'fact',
    status: 'active',
    extractorConfidence: 0.9,
    confidence: 0.9,
    firstAssertedAt: 'c1',
    lastSurfacedAt: 'c1',
    origin: 'user',
    negated: false,
    sourceType: null,
    summary: null,
    evidence: [{ candidateId: 'c1', role: 'user' }],
    related: [],
    entities: ['user'],
    timesObserved: 1,
    accessCount: 0,
    lastAccessedAt: null,
    activation: null,
    locked: false,
    emotional: null,
    promotion: 'approved:a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('orders authority, then corroboration, then recency, then id', () => {
    const auto = { ...base, id: 'auto', promotion: 'auto' };
    const approved = { ...base, id: 'appr', promotion: 'approved:a9' };
    // Authority beats everything, even fresher corroborated rivals.
    expect(
      pickRevisionWinner([
        { ...auto, timesObserved: 9, updatedAt: '2026-09-30T00:00:00.000Z' },
        approved,
      ]).id,
    ).toBe('appr');
    // Corroboration beats recency among approved peers.
    expect(
      pickRevisionWinner([
        { ...approved, id: 'new', updatedAt: '2026-09-30T00:00:00.000Z' },
        { ...approved, id: 'old', timesObserved: 4 },
      ]).id,
    ).toBe('old');
    // Recency breaks corroboration ties; id breaks the rest.
    expect(
      pickRevisionWinner([
        { ...approved, id: 'zz', updatedAt: '2026-01-02T00:00:00.000Z' },
        { ...approved, id: 'aa', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]).id,
    ).toBe('zz');
    expect(
      pickRevisionWinner([
        { ...approved, id: 'zz' },
        { ...approved, id: 'aa' },
      ]).id,
    ).toBe('aa');
    expect(() => pickRevisionWinner([])).toThrow('needs a rival');
  });
});

describe('MaintenanceService revision, lock, and classification', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setupRungs = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'rungs.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    const history = new SqliteClaimHistoryRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const candidates = new SqliteMemoryCandidateRepository(service);
    const reliability = new SqliteSourceReliabilityRepository(service);
    const prospective = new SqliteProspectiveItemRepository(service);
    const traces = new RecallTraceStore();
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
      candidates,
      reliability,
      prospective,
      traces,
    );
    return {
      maintenance,
      claims,
      history,
      candidates,
      reliability,
      config,
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-rungs-'));
    counter = 0;
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const seedCandidate = async (
    setupResult: ReturnType<typeof setupRungs>,
    object: string,
  ) => {
    const [saved] = await setupResult.candidates.saveCandidates([
      {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
        object,
        confidence: 0.9,
        importance: 0.5,
        stability: 0.5,
        sourceRole: 'user',
        negated: false,
        source: { sessionId: 's1', messageId: 1, role: 'user' },
        extractorModel: 'test-model',
        extractorVersion: 'v1',
      },
    ]);
    if (!saved) throw new Error('candidate seeding failed');
    return saved;
  };

  it('resolves standing rival pairs by policy with full audit', async () => {
    const s = setupRungs();
    // Ledger rows first: reliability tracks real sources.
    const tea = await seedCandidate(s, 'tea');
    const coffee = await seedCandidate(s, 'coffee');
    // Active-active pair the promotion path never converged (race).
    // Auto promotion loses to approved regardless of timing.
    const auto = await s.claims.createClaim(
      claim('user', 'likes', 'tea', {
        promotion: 'auto',
        evidence: [{ candidateId: tea.id, role: 'user' }],
      }),
    );
    const approved = await s.claims.createClaim(
      claim('user', 'likes', 'coffee', {
        evidence: [{ candidateId: coffee.id, role: 'user' }],
      }),
    );
    // Same-session bystander (different pair): time-anchored context.
    const [water] = await s.candidates.saveCandidates([
      {
        kind: 'fact',
        subject: 'user',
        predicate: 'drinks',
        object: 'water',
        confidence: 0.9,
        importance: 0.5,
        stability: 0.5,
        sourceRole: 'user',
        negated: false,
        source: { sessionId: 's1', messageId: 2, role: 'user' },
        extractorModel: 'test-model',
        extractorVersion: 'v1',
      },
    ]);
    if (!water) throw new Error('candidate seeding failed');
    const bystander = await s.claims.createClaim(
      claim('user', 'drinks', 'water', {
        evidence: [{ candidateId: water.id, role: 'user' }],
      }),
    );

    expect(await s.maintenance.runPass()).toMatchObject({ revised: 1 });
    expect((await s.claims.getClaim(approved.id))?.status).toBe('active');
    expect((await s.claims.getClaim(auto.id))?.status).toBe('contradicted');
    // Both sides linked, both sides historied.
    expect((await s.claims.getClaim(auto.id))?.related).toEqual([approved.id]);
    // Winner additionally anchors the session context (one-way).
    expect((await s.claims.getClaim(approved.id))?.related).toEqual([
      auto.id,
      bystander.id,
    ]);
    expect(
      (await s.history.listByClaimId(auto.id)).map((row) => row.transition),
    ).toEqual(['revise', 'classify']);
    const winnerHistory = await s.history.listByClaimId(approved.id);
    expect(winnerHistory).toMatchObject([{ transition: 'revise' }]);
    expect(winnerHistory[0]?.detail).toMatchObject({
      anchoredSessions: ['s1'],
      anchoredClaims: [bystander.id],
    });
    // Winner source wins, loser source loses.
    expect(await s.reliability.get('user/test-model')).toMatchObject({
      wins: 1,
      losses: 1,
    });
  });

  it('locks high corroboration and unlocks losing evidence', async () => {
    const s = setupRungs();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript', {
        evidence: [
          { candidateId: 'c1', role: 'user' },
          { candidateId: 'c2', role: 'user' },
        ],
      }),
    );
    for (const id of ['c3', 'c4', 'c5', 'c6']) {
      await s.claims.appendEvidence(
        saved.id,
        [{ candidateId: id, role: 'user' }],
        0.9,
      );
    }

    // Pass 1 compounds (5 observations); pass 2 locks at 0.99.
    expect(await s.maintenance.runPass()).toMatchObject({ compounded: 1 });
    expect(await s.maintenance.runPass()).toMatchObject({ locked: 1 });
    expect((await s.claims.getClaim(saved.id))?.locked).toBe(true);
    expect(await s.history.listByClaimId(saved.id)).toMatchObject([
      { transition: 'compound' },
      { transition: 'lock' },
    ]);

    // Locked certainty guards decay but never revision's evidence:
    // contradicted while locked unlocks with history.
    await s.claims.setStatus(saved.id, 'contradicted');
    expect(await s.maintenance.runPass()).toMatchObject({ locked: 1 });
    expect((await s.claims.getClaim(saved.id))?.locked).toBe(false);
    expect(
      (await s.history.listByClaimId(saved.id)).map((row) => row.transition),
    ).toEqual(['compound', 'lock', 'unlock']);
  });

  it('stamps source types once by fixed rule', async () => {
    const s = setupRungs();
    const direct = await s.claims.createClaim(
      claim('user', 'prefers', 'a', { extractorConfidence: 0.9 }),
    );
    const agent = await s.claims.createClaim(
      claim('system', 'runs_on', 'b', {
        origin: 'agent',
        evidence: [{ candidateId: 'cx', role: 'assistant' }],
      }),
    );
    const vague = await s.claims.createClaim(
      claim('user', 'likes', 'c', { extractorConfidence: 0.3 }),
    );

    expect(await s.maintenance.runPass()).toMatchObject({ classified: 3 });
    expect((await s.claims.getClaim(direct.id))?.sourceType).toBe(
      'direct_statement',
    );
    expect((await s.claims.getClaim(agent.id))?.sourceType).toBe('inference');
    expect((await s.claims.getClaim(vague.id))?.sourceType).toBe('speculation');

    // First stamp wins; re-passes skip.
    expect(await s.maintenance.runPass()).toMatchObject({
      classified: 0,
      skipped: 3,
    });
  });

  it('dampens agent self-echo at compounding time', async () => {
    const s = setupRungs();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript', {
        origin: 'agent',
        evidence: [
          { candidateId: 'c1', role: 'assistant' },
          { candidateId: 'c2', role: 'assistant' },
        ],
      }),
    );
    await s.claims.appendEvidence(
      saved.id,
      [{ candidateId: 'c3', role: 'assistant' }],
      0.9,
    );

    expect(await s.maintenance.runPass()).toMatchObject({ compounded: 1 });
    // 0.9 + 0.02 × 2 × 0.5 dampening (vs 0.94 undampened).
    expect((await s.claims.getClaim(saved.id))?.confidence).toBeCloseTo(
      0.92,
      6,
    );
    expect(await s.history.listByClaimId(saved.id)).toMatchObject([
      { transition: 'compound' },
    ]);
    expect((await s.history.listByClaimId(saved.id))[0]?.detail).toMatchObject({
      dampened: true,
      factor: 0.5,
    });
  });
});

describe('activation math', () => {
  it('boosts, decays, and fan-caps shares in closed bounds', () => {
    expect(activationBoost(null)).toBe(0.3);
    expect(activationBoost(0.8)).toBe(1);
    expect(activationDecayStep(0.04)).toBe(0);
    expect(activationDecayStep(0.5)).toBeCloseTo(0.45, 6);
    expect(spreadShare(0)).toBe(0.3);
    expect(spreadShare(2)).toBeCloseTo(0.15, 6);
    expect(spreadShare(99)).toBeCloseTo(0.06, 6);
  });
});

describe('MaintenanceService activation', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setupActive = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'active.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    const history = new SqliteClaimHistoryRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const candidates = new SqliteMemoryCandidateRepository(service);
    const reliability = new SqliteSourceReliabilityRepository(service);
    const prospective = new SqliteProspectiveItemRepository(service);
    const traces = new RecallTraceStore();
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
      candidates,
      reliability,
      prospective,
      traces,
    );
    return {
      maintenance,
      claims,
      history,
      prospective,
      traces,
      config,
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-active-'));
    counter = 0;
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('boosts accessed claims and spreads fan-capped shares', async () => {
    const s = setupActive();
    const hub = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    // Distinct predicates: no gist family, no revision pair — the
    // test isolates activation, not conflict.
    const n1 = await s.claims.createClaim(claim('user', 'likes', 'tea'));
    const n2 = await s.claims.createClaim(claim('user', 'uses', 'vim'));
    // Related fan: hub touches both neighbors.
    await s.claims.addRelated(hub.id, [n1.id, n2.id]);
    await s.claims.recordAccessed([hub.id]);

    expect(await s.maintenance.runPass()).toMatchObject({ activated: 1 });
    expect((await s.claims.getClaim(hub.id))?.activation).toBeCloseTo(0.3, 6);
    // 0.3 / 2 neighbors each.
    expect((await s.claims.getClaim(n1.id))?.activation).toBeCloseTo(0.15, 6);
    expect((await s.claims.getClaim(n2.id))?.activation).toBeCloseTo(0.15, 6);
    const rows = await s.history.listByClaimId(hub.id);
    expect(rows.map((row) => row.transition)).toContain('activate');
  });

  it('leaves untouched null activation alone (no rows, no history)', async () => {
    const s = setupActive();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );

    // Classification still fires (metadata rung); activation is
    // untouched: null stays null with no activate row.
    expect(await s.maintenance.runPass()).toMatchObject({
      activated: 0,
      classified: 1,
    });
    expect((await s.claims.getClaim(saved.id))?.activation).toBeNull();
    expect(
      (await s.history.listByClaimId(saved.id)).map((row) => row.transition),
    ).toEqual(['classify']);
  });

  it('decays stale activation once per interval window', async () => {
    const s = setupActive();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    await s.claims.recordAccessed([saved.id]);
    await s.maintenance.runPass();
    expect((await s.claims.getClaim(saved.id))?.activation).toBeCloseTo(0.3, 6);

    // Immediate re-pass: interval gate holds (no ratchet, no spam).
    // Classification fires instead (first stamp wins) — activation
    // itself is untouched.
    expect(await s.maintenance.runPass()).toMatchObject({
      activated: 0,
      classified: 1,
    });
    expect((await s.claims.getClaim(saved.id))?.activation).toBeCloseTo(0.3, 6);
  });

  it('parks loud-but-wrong divergence for review, once per pair', async () => {
    const s = setupActive();
    const loud = await s.claims.createClaim(
      claim('user', 'prefers', 'phlogiston', { confidence: 0.3 }),
    );
    // Each access must be unanswered: access, pass ×3.
    // (Boosts 0.3 → 0.6 → 0.9; the third crosses the divergence bar.)
    // Sleeps separate the access timestamps: same-millisecond
    // touches are one touch (production turns take seconds; tests
    // do not).
    for (let i = 0; i < 3; i++) {
      await s.claims.recordAccessed([loud.id]);
      await s.maintenance.runPass();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect((await s.claims.getClaim(loud.id))?.activation).toBeCloseTo(0.9, 6);
    const items = await s.prospective.listItems({ status: 'open' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      trigger: 'confidence_drop',
      status: 'open',
    });

    // Next pass with no new access: interval gate holds, and no
    // duplicate question parks.
    const summary = await s.maintenance.runPass();
    expect(summary.activated).toBe(0);
    expect((await s.prospective.listItems({ status: 'open' })).length).toBe(1);
  });

  it('suppresses familiar competitors from stored traces, once per trace', async () => {
    const s = setupActive();
    const target = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript'),
    );
    // Distinct predicate: a near-miss, not a revision pair.
    const rival = await s.claims.createClaim(claim('user', 'likes', 'tea'));
    await s.claims.setActivation(rival.id, 0.5);
    s.traces.save({
      sessionId: 's1',
      query: { text: 'language?', tokens: ['language'] },
      surfaces: {},
      ranked: [
        {
          claimId: target.id,
          disposition: 'recalled',
          demoted: false,
          fusedScore: 0.9,
          surfaces: ['lexical'],
          reasons: [],
        },
        {
          claimId: rival.id,
          disposition: 'familiar',
          demoted: false,
          fusedScore: 0.2,
          surfaces: ['lexical'],
          reasons: [],
        },
      ],
      notes: [],
      proposedQuestions: [],
      lens: { exclude: [] },
      gate: 0.3,
      bands: { memory: true, kb: false },
      kbAvailable: false,
      degraded: [],
    });

    // Rival also activates this pass (fresh access below) — order:
    // suppression prologue runs before the ladder touches it.
    await s.claims.recordAccessed([rival.id]);
    const summary = await s.maintenance.runPass();
    expect(summary.suppressed).toBe(1);
    // 0.5 suppressed, then the ladder boosts the fresh access.
    const rivalNow = await s.claims.getClaim(rival.id);
    expect(rivalNow?.activation ?? 0).toBeGreaterThan(0.4);
    expect(
      (await s.history.listByClaimId(rival.id)).map((row) => row.transition),
    ).toContain('suppress');

    // Second pass: same trace, already suppressed — silent.
    expect(await s.maintenance.runPass()).toMatchObject({ suppressed: 0 });
  });
});

describe('MaintenanceService longitudinal invariants (M12f)', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setupLong = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'long.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const claims = new SqliteClaimRepository(service);
    const history = new SqliteClaimHistoryRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const candidates = new SqliteMemoryCandidateRepository(service);
    const reliability = new SqliteSourceReliabilityRepository(service);
    const prospective = new SqliteProspectiveItemRepository(service);
    const traces = new RecallTraceStore();
    const maintenance = new MaintenanceService(
      config,
      claims,
      history,
      journal,
      candidates,
      reliability,
      prospective,
      traces,
    );
    return {
      maintenance,
      claims,
      history,
      journal,
      candidates,
      db: service,
      config,
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-long-'));
    counter = 0;
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const ledgerChecksum = async (
    setupResult: ReturnType<typeof setupLong>,
  ): Promise<string> => {
    const rows = await setupResult.candidates.listCandidates(undefined, {
      limit: 10000,
    });
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  };

  it('approaches the ceiling asymptotically, never jumping', async () => {
    const s = setupLong();
    const saved = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript', { confidence: 0.5 }),
    );
    let previous = 0.5;
    // Twelve corroborations: compounding per level, bounded. Each
    // append carries the current estimate forward (appendEvidence
    // sets what it is told — the pass is what compounds).
    for (let i = 0; i < 12; i++) {
      const base = (await s.claims.getClaim(saved.id))?.confidence ?? 0.5;
      await s.claims.appendEvidence(
        saved.id,
        [{ candidateId: `cx-${i}`, role: 'user' }],
        base,
      );
      await s.maintenance.runPass();
      const current = (await s.claims.getClaim(saved.id))?.confidence ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current).toBeLessThanOrEqual(0.99);
      // Single observations never jump: bounded step per pass.
      expect(current - previous).toBeLessThan(0.11);
      previous = current;
    }
    expect(previous).toBe(0.99);
  });

  it('pairs every history row with matching state, ledger stable', async () => {
    const s = setupLong();
    // A real ledger row: the checksum below must prove the pass
    // never touches candidates, not merely preserve emptiness.
    await s.candidates.saveCandidates([
      {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
        object: 'seed',
        confidence: 0.9,
        importance: 0.5,
        stability: 0.5,
        sourceRole: 'user',
        negated: false,
        source: { sessionId: 's1', messageId: 1, role: 'user' },
        extractorModel: 'mem',
        extractorVersion: 'v1',
      },
    ]);
    const before = await ledgerChecksum(s);
    // Compoundable (timesObserved moves only through REINFORCE).
    const reinforced = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript', {
        evidence: [
          { candidateId: 'c1', role: 'user' },
          { candidateId: 'c2', role: 'user' },
        ],
      }),
    );
    await s.claims.appendEvidence(
      reinforced.id,
      [{ candidateId: 'c3', role: 'user' }],
      0.9,
    );
    // Decaying (backdated touch).
    const stale = await s.claims.createClaim(claim('user', 'likes', 'rain'));
    s.db.connection
      .prepare('UPDATE claims SET updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', stale.id);
    // Linkable contradict pair (journal-committed).
    const oldie = await s.claims.createClaim(claim('user', 'uses', 'vim'));
    const newie = await s.claims.createClaim(claim('user', 'uses', 'emacs'));
    await s.claims.setStatus(oldie.id, 'contradicted');
    const proposed = await s.journal.recordProposal({
      candidateId: 'cand-x',
      operation: 'CONTRADICT',
    });
    await s.journal.setState(proposed.id, 'committed', {
      claimId: newie.id,
      detail: `contradicts:${oldie.id}`,
    });
    // Gist trio (distinct evidence, same pair).
    for (const object of ['coffee', 'tea', 'water']) {
      await s.claims.createClaim(
        claim('user', 'drinks', object, {
          evidence: [{ candidateId: `e-${object}`, role: 'user' }],
        }),
      );
    }
    // Revision pair (approved beats auto).
    await s.claims.createClaim(
      claim('user', 'edits', 'nano', { promotion: 'auto' }),
    );
    await s.claims.createClaim(claim('user', 'edits', 'helix'));
    // Classifiable loner.
    await s.claims.createClaim(claim('user', 'naps', 'daily'));

    const summary = await s.maintenance.runPass();
    expect(summary).toMatchObject({
      compounded: 1,
      decayed: 1,
      linked: 2,
      gistProposed: 3,
      revised: 1,
    });

    // Audit pairing: every history row matches current state.
    const all = await s.claims.listClaims({ limit: 500 });
    for (const row of all) {
      const live = (await s.claims.getClaim(row.id)) ?? row;
      for (const entry of await s.history.listByClaimId(row.id)) {
        switch (entry.transition) {
          case 'compound':
          case 'decay':
            expect(live.confidence).toBeLessThanOrEqual(
              entry.confidenceAfter ?? 1,
            );
            break;
          case 'revise':
            if ((entry.detail['outcome'] as string) === 'superseded') {
              expect(live.status).toBe('contradicted');
            } else {
              expect(live.status).toBe('active');
            }
            break;
          case 'link':
            for (const id of (entry.detail['related'] as string[]) ?? []) {
              expect(live.related).toContain(id);
            }
            break;
          case 'gist_proposed':
            expect((entry.detail['family'] as string[]).length).toBeGreaterThan(
              0,
            );
            break;
          case 'classify':
            expect(live.sourceType).toBe(entry.detail['sourceType'] as string);
            break;
          default:
            break;
        }
      }
    }
    // One active head per triple.
    const heads = all.filter((c) => c.status === 'active');
    const triples = heads.map(
      (c) =>
        `${c.subject}|${c.predicate}|${c.object}|${c.negated ? 'neg' : 'aff'}`,
    );
    expect(new Set(triples).size).toBe(triples.length);

    // The ledger never moves, no matter how many passes age beliefs.
    expect(await ledgerChecksum(s)).toBe(before);
    await s.maintenance.runPass();
    expect(await ledgerChecksum(s)).toBe(before);
  });

  it('leaves no history without a matching state on crash', async () => {
    const s = setupLong();
    const reinforced = await s.claims.createClaim(
      claim('user', 'prefers', 'TypeScript', {
        evidence: [
          { candidateId: 'c1', role: 'user' },
          { candidateId: 'c2', role: 'user' },
        ],
      }),
    );
    // timesObserved moves only through REINFORCE — without this the
    // claim below would skip compounding and the test would prove
    // nothing.
    await s.claims.appendEvidence(
      reinforced.id,
      [{ candidateId: 'c3', role: 'user' }],
      0.9,
    );
    await s.claims.createClaim(claim('user', 'likes', 'rain'));
    const failingJournal = {
      listByState: () => Promise.reject(new Error('journal down')),
    } as unknown as PromotionJournalRepository;
    const probing = new MaintenanceService(
      s.config,
      s.claims,
      s.history,
      failingJournal,
      s.candidates,
      new SqliteSourceReliabilityRepository(s.db),
      new SqliteProspectiveItemRepository(s.db),
      new RecallTraceStore(),
    );

    expect(await probing.runPass()).toMatchObject({
      compounded: 1,
      failed: 1,
    });
    // The failed record carries no history at all: nothing
    // half-applied, nothing to recover.
    const failed = await s.claims.findByTriple({
      subject: 'user',
      predicate: 'likes',
      object: 'rain',
    });
    expect(failed).toBeDefined();
    expect(await s.history.listByClaimId(failed?.id ?? '')).toEqual([]);
  });
});
