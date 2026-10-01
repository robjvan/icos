import type { CoreConfig } from '../config';
import type { Claim } from './claim';
import { ClaimRepository } from './claim.repository';
import { MemoryCandidateRepository } from './memory-candidate.repository';
import { RankService } from './rank.service';
import type { RecallHit } from './recall.service';
import { SourceReliabilityRepository } from './source-reliability.repository';
import { ageDaysBetween, recencyBoost, rrfFuse } from './ranking';

const NOW = Date.parse('2026-09-30T00:00:00.000Z');

let counter = 0;
const mkClaim = (overrides: Partial<Claim> = {}): Claim => {
  counter += 1;
  return {
    id: `claim-${counter}`,
    subject: 'user',
    predicate: 'prefers',
    object: `thing-${counter}`,
    category: 'fact',
    status: 'active',
    extractorConfidence: 0.9,
    confidence: 0.9,
    firstAssertedAt: `cand-${counter}`,
    lastSurfacedAt: `cand-${counter}`,
    origin: 'user',
    negated: false,
    sourceType: null,
    summary: null,
    evidence: [{ candidateId: `cand-${counter}`, role: 'user' }],
    related: [],
    entities: ['user'],
    timesObserved: 1,
    accessCount: 0,
    lastAccessedAt: null,
    activation: null,
    locked: false,
    emotional: null,
    promotion: 'approved:appr-1',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
};

const stubClaims = (claims: Claim[]): ClaimRepository =>
  ({
    getClaim: (id: string) =>
      Promise.resolve(claims.find((claim) => claim.id === id) ?? null),
  }) as unknown as ClaimRepository;

const stubCandidates = (
  extractedAt: Record<string, string>,
  provenance: Record<
    string,
    {
      role: 'user' | 'assistant' | 'unknown';
      model: string;
    }
  > = {},
): MemoryCandidateRepository =>
  ({
    getCandidate: (id: string) =>
      Promise.resolve(
        extractedAt[id] === undefined
          ? null
          : ({
              id,
              extractedAt: extractedAt[id],
              source: {
                sessionId: 's1',
                messageId: 1,
                role: provenance[id]?.role ?? 'user',
              },
              extractorModel: provenance[id]?.model ?? 'test-model',
            } as unknown as import('./memory-candidate').MemoryCandidate),
      ),
  }) as unknown as MemoryCandidateRepository;

const stubReliability = (
  records: Record<string, { wins: number; losses: number }> = {},
): SourceReliabilityRepository =>
  ({
    get: (sourceKey: string) =>
      Promise.resolve(
        records[sourceKey] === undefined
          ? null
          : {
              sourceKey,
              ...records[sourceKey],
              updatedAt: 't',
            },
      ),
    recordOutcome: (sourceKey: string, won: boolean) =>
      Promise.resolve({
        sourceKey,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        updatedAt: 't',
      }),
  }) as unknown as SourceReliabilityRepository;

const ranker = (
  claims: Claim[],
  extractedAt: Record<string, string>,
  gate = 0.3,
  reliability: SourceReliabilityRepository = stubReliability(),
  provenance: Record<
    string,
    {
      role: 'user' | 'assistant' | 'unknown';
      model: string;
    }
  > = {},
): RankService =>
  new RankService(
    { memoryRecallConfidenceGate: gate } as CoreConfig,
    stubClaims(claims),
    stubCandidates(extractedAt, provenance),
    reliability,
  );

const hit = (claimId: string, surface: RecallHit['surface']): RecallHit => ({
  claimId,
  score: 0,
  surface,
});

describe('ranking primitives', () => {
  it('fuses ranks order-only (RRF-60)', () => {
    expect(rrfFuse([1])).toBeCloseTo(1 / 61, 6);
    expect(rrfFuse([1, 1])).toBeGreaterThan(rrfFuse([1]));
    expect(rrfFuse([1])).toBeGreaterThan(rrfFuse([2]));
  });

  it('decays recency as a true gradient', () => {
    expect(recencyBoost(0)).toBe(1);
    expect(recencyBoost(30)).toBeCloseTo(0.5, 5);
    expect(recencyBoost(300)).toBeLessThan(recencyBoost(30));
    expect(ageDaysBetween(NOW, '2026-09-29T00:00:00.000Z')).toBe(1);
    expect(ageDaysBetween(NOW, 'not-a-date')).toBe(0);
    expect(ageDaysBetween(NOW, '2026-10-01T00:00:00.000Z')).toBe(0);
  });
});

describe('RankService', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('fuses multi-surface claims above single-surface ones, deduped', async () => {
    const a = mkClaim({ object: 'A' });
    const b = mkClaim({ object: 'B' });
    const fresh: Record<string, string> = {
      [a.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
      [b.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
    };
    const service = ranker([a, b], fresh);

    const { ranked } = await service.rank(
      [hit(a.id, 'lexical'), hit(a.id, 'semantic'), hit(b.id, 'lexical')],
      { nowMs: NOW },
    );
    expect(ranked.map((row) => row.claim.id)).toEqual([a.id, b.id]);
    expect(ranked[0]?.surfaces.sort()).toEqual(['lexical', 'semantic']);
    expect(ranked.map((row) => row.disposition)).toEqual([
      'recalled',
      'recalled',
    ]);
  });

  it('gates low confidence, admits on explicit query or lock', async () => {
    const weak = mkClaim({ confidence: 0.1 });
    const service = ranker([weak], {
      [weak.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
    });

    const gated = await service.rank([hit(weak.id, 'lexical')], {
      nowMs: NOW,
    });
    expect(gated.ranked[0]?.disposition).toBe('excluded');
    expect(gated.ranked[0]?.excludeReason).toBe('gate');
    expect(gated.trace.gated).toEqual([weak.id]);

    const explicit = await service.rank([hit(weak.id, 'lexical')], {
      nowMs: NOW,
      includeGated: true,
    });
    expect(explicit.ranked[0]?.disposition).toBe('recalled');
    expect(explicit.trace.gated).toEqual([]);
    expect(explicit.ranked[0]?.reasons.join(' ')).toContain('explicit query');

    const lockedService = ranker(
      [mkClaim({ id: weak.id, confidence: 0.1, locked: true })],
      { [weak.lastSurfacedAt]: '2026-09-29T00:00:00.000Z' },
    );
    const locked = await lockedService.rank([hit(weak.id, 'lexical')], {
      nowMs: NOW,
    });
    expect(locked.ranked[0]?.disposition).toBe('recalled');
  });

  it('demotes contradicted claims without dropping them', async () => {
    const affirmed = mkClaim({ object: 'same' });
    const contradicted = mkClaim({
      object: 'same-rival',
      status: 'contradicted',
    });
    const fresh: Record<string, string> = {
      [affirmed.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
      [contradicted.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
    };
    const service = ranker([affirmed, contradicted], fresh);

    const { ranked, trace } = await service.rank(
      [hit(affirmed.id, 'lexical'), hit(contradicted.id, 'lexical')],
      { nowMs: NOW },
    );
    // Same surface rank; the contradicted twin sinks but stays recalled.
    expect(ranked.map((row) => row.claim.id)[0]).toBe(affirmed.id);
    const loser = ranked.find((row) => row.claim.id === contradicted.id);
    expect(loser).toMatchObject({ disposition: 'recalled', demoted: true });
    expect(trace.demoted).toEqual([contradicted.id]);
    expect(loser?.reasons.join(' ')).toContain('contradicted');
  });

  it('weights true evidence time as a gradient', async () => {
    const freshClaim = mkClaim({ object: 'fresh' });
    const staleClaim = mkClaim({ object: 'stale' });
    const service = ranker([freshClaim, staleClaim], {
      [freshClaim.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
      [staleClaim.lastSurfacedAt]: '2025-01-01T00:00:00.000Z',
    });

    const { ranked } = await service.rank(
      [hit(staleClaim.id, 'lexical'), hit(freshClaim.id, 'lexical')],
      { nowMs: NOW },
    );
    // Input order favors stale (rank 1); recency overturns it.
    expect(ranked.map((row) => row.claim.id)).toEqual([
      freshClaim.id,
      staleClaim.id,
    ]);
  });

  it('falls back to claim timestamps when the ledger lost a row', async () => {
    const orphan = mkClaim({
      lastSurfacedAt: 'missing-candidate',
      updatedAt: '2026-09-29T00:00:00.000Z',
    });
    const service = ranker([orphan], {});

    const { ranked, trace } = await service.rank([hit(orphan.id, 'lexical')], {
      nowMs: NOW,
    });
    expect(ranked[0]?.disposition).toBe('recalled');
    expect(trace.recencyFallback).toEqual([orphan.id]);
  });

  it('applies the provenance lens without touching the store', async () => {
    const userClaim = mkClaim({ object: 'mine' });
    const agentClaim = mkClaim({ object: 'chatter', origin: 'agent' });
    const fresh: Record<string, string> = {
      [userClaim.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
      [agentClaim.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
    };
    const service = ranker([userClaim, agentClaim], fresh);

    const excluded = await service.rank(
      [hit(userClaim.id, 'lexical'), hit(agentClaim.id, 'lexical')],
      { nowMs: NOW, lens: { exclude: ['agent'] } },
    );
    expect(
      excluded.ranked.find((row) => row.claim.id === agentClaim.id),
    ).toMatchObject({ disposition: 'excluded', excludeReason: 'lens' });
    expect(excluded.trace.lensExcluded).toEqual([agentClaim.id]);
    // The store row is untouched — the lens only hides.
    expect(
      excluded.ranked.find((row) => row.claim.id === userClaim.id)?.disposition,
    ).toBe('recalled');

    const dampened = await service.rank(
      [hit(userClaim.id, 'lexical'), hit(agentClaim.id, 'lexical')],
      { nowMs: NOW, lens: { downweight: { agent: 0.01 } } },
    );
    expect(dampened.ranked.map((row) => row.claim.id)[0]).toBe(userClaim.id);
  });

  it('labels near-misses familiar and leaves the rest unranked', async () => {
    const claims = Array.from({ length: 9 }, (_, i) =>
      mkClaim({ object: `thing-${i}` }),
    );
    const fresh: Record<string, string> = Object.fromEntries(
      claims.map((claim) => [claim.lastSurfacedAt, '2026-09-29T00:00:00.000Z']),
    );
    const service = ranker(claims, fresh);

    const { ranked, trace } = await service.rank(
      claims.map((claim) => hit(claim.id, 'lexical')),
      { nowMs: NOW },
    );
    expect(ranked.filter((row) => row.disposition === 'recalled')).toHaveLength(
      5,
    );
    const familiar = ranked.filter((row) => row.disposition === 'familiar');
    expect(familiar).toHaveLength(3);
    expect(trace.familiar).toHaveLength(3);
    expect(ranked.filter((row) => row.disposition === 'unranked')).toHaveLength(
      1,
    );
    expect(familiar[0]?.reasons.join(' ')).toContain('near-miss');
  });

  it('suppresses near-duplicates, keeping the stronger twin', async () => {
    const strong = mkClaim({ object: 'TypeScript' });
    const weak = mkClaim({ object: '  TYPESCRIPT ' });
    const fresh: Record<string, string> = {
      [strong.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
      [weak.lastSurfacedAt]: '2025-01-01T00:00:00.000Z',
    };
    const service = ranker([strong, weak], fresh);

    const { ranked, trace } = await service.rank(
      [hit(weak.id, 'lexical'), hit(strong.id, 'semantic')],
      { nowMs: NOW },
    );
    expect(ranked.find((row) => row.claim.id === weak.id)).toMatchObject({
      disposition: 'excluded',
      excludeReason: 'duplicate',
    });
    expect(trace.duplicates).toEqual([weak.id]);
  });

  it('traces vanished claims instead of failing', async () => {
    const service = ranker([], {});
    const { ranked, trace } = await service.rank([hit('ghost', 'lexical')], {
      nowMs: NOW,
    });
    expect(ranked).toEqual([]);
    expect(trace.vanished).toEqual(['ghost']);
  });

  it('dampens repeatedly-losing sources with the factor in the trace', async () => {
    const good = mkClaim({ object: 'good' });
    const bad = mkClaim({ object: 'bad' });
    const fresh: Record<string, string> = {
      [good.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
      [bad.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
    };
    const provenance = {
      [good.lastSurfacedAt]: {
        role: 'user' as const,
        model: 'steady-model',
      },
      [bad.lastSurfacedAt]: { role: 'user' as const, model: 'shaky-model' },
    };
    const service = ranker(
      [good, bad],
      fresh,
      0.3,
      stubReliability({
        'user/steady-model': { wins: 5, losses: 0 },
        'user/shaky-model': { wins: 0, losses: 3 },
      }),
      provenance,
    );

    const { ranked } = await service.rank(
      [hit(good.id, 'lexical'), hit(bad.id, 'lexical')],
      { nowMs: NOW },
    );
    // shaky: (0+1)/(0+3+2) = 0.2 → min(1, 0.7); steady caps at 1 (neutral).
    const badRow = ranked.find((row) => row.claim.id === bad.id);
    expect(badRow?.reliability).toBeCloseTo(0.7, 6);
    expect(badRow?.reasons.join(' ')).toContain('source reliability 0.70');
    const goodRow = ranked.find((row) => row.claim.id === good.id);
    expect(goodRow?.reliability).toBeNull();
    // The punished source ranks below its twin.
    expect(ranked[0]?.claim.id).toBe(good.id);
  });

  it('leaves claims alone without a track record', async () => {
    const lone = mkClaim({ object: 'lone' });
    const service = ranker([lone], {
      [lone.lastSurfacedAt]: '2026-09-29T00:00:00.000Z',
    });

    const { ranked } = await service.rank([hit(lone.id, 'lexical')], {
      nowMs: NOW,
    });
    expect(ranked[0]).toMatchObject({
      disposition: 'recalled',
      reliability: null,
    });
    expect(ranked[0]?.reasons.join(' ')).not.toContain('reliability');
  });
});
