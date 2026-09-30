import type { Claim } from './claim';
import type { ComparisonNote } from './comparison';
import {
  applyBandBudget,
  buildKbBand,
  buildMemoryBand,
  estimateTokens,
} from './prompt-bands';
import type { RankedClaim } from './rank.service';

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

const ranked = (
  claims: Claim[],
  disposition: RankedClaim['disposition'] = 'recalled',
): RankedClaim[] =>
  claims.map((claim) => ({
    claim,
    fusedScore: 0.5,
    surfaces: ['lexical' as const],
    disposition,
    demoted: claim.status === 'contradicted',
    reasons: [],
  }));

describe('buildMemoryBand', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('labels every row with origin and confidence, never as user speech', () => {
    const band = buildMemoryBand(
      ranked([mkClaim({ object: 'TypeScript', confidence: 0.9 })]),
      [],
    );
    expect(band).toContain('[memory:');
    expect(band).toContain('user prefers "TypeScript"');
    expect(band).toContain('origin user');
    expect(band).toContain('confidence 0.90');
    expect(band).toContain('beliefs, not user speech');
  });

  it('flags contradicted rows and states conflicts inline', () => {
    const band = buildMemoryBand(
      ranked([
        mkClaim({ object: 'TypeScript', status: 'contradicted' }),
        mkClaim({ object: 'Rust' }),
      ]),
      [
        {
          kind: 'conflict',
          subject: 'user',
          predicate: 'prefers',
          parties: [
            {
              claimId: 'a',
              object: 'TypeScript',
              origin: 'user',
              confidence: 1,
              negated: false,
              status: 'contradicted',
            },
            {
              claimId: 'b',
              object: 'Rust',
              origin: 'user',
              confidence: 1,
              negated: false,
              status: 'active',
            },
          ],
          relatedIds: [],
        },
      ],
    );
    expect(band).toContain('contradicted — superseded, kept for context');
    expect(band).toContain(
      '[conflict] user prefers: "TypeScript" (origin user, contradicted) vs "Rust" (origin user, active)',
    );
  });

  it('renders negated beliefs distinctly and voices near-misses uncertainly', () => {
    const band = buildMemoryBand(
      ranked([mkClaim({ object: 'TypeScript', negated: true })]).concat(
        ranked([mkClaim({ object: 'tea', confidence: 0.4 })], 'familiar'),
      ),
      [] as ComparisonNote[],
    );
    expect(band).toContain('user prefers not "TypeScript"');
    expect(band).toContain('[vaguely familiar — uncertain, not verified]');
  });

  it('returns null when there is nothing to say', () => {
    expect(buildMemoryBand([], [])).toBeNull();
    expect(buildMemoryBand(ranked([mkClaim()], 'unranked'), [])).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('estimates chars/4 rounded up, minimum one', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('applyBandBudget', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('shrinks familiar first, then demoted, then lowest fused', () => {
    const recalled = [
      mkClaim({ object: 'keep-high' }),
      mkClaim({ object: 'drop-low' }),
    ];
    const familiar = [mkClaim({ object: 'drop-familiar' })];
    const demoted = [
      mkClaim({ object: 'drop-demoted', status: 'contradicted' }),
    ];
    const row = (
      claim: Claim,
      fusedScore: number,
      disposition: RankedClaim['disposition'],
      isDemoted: boolean,
    ): RankedClaim => ({
      claim,
      fusedScore,
      surfaces: ['lexical'],
      disposition,
      demoted: isDemoted,
      reasons: [],
    });
    const rows = [
      row(recalled[0], 0.9, 'recalled', false),
      row(recalled[1], 0.5, 'recalled', false),
      row(familiar[0], 0.3, 'familiar', false),
      row(demoted[0], 0.8, 'recalled', true),
    ];
    // Cap admits the header plus roughly one row.
    const { ranked, dropped, band } = applyBandBudget(rows, [], {
      maxTokens: 40,
    });
    expect(band).toContain('keep-high');
    expect(band).not.toContain('drop-familiar');
    // Familiar drops before demoted before low recalled.
    expect(dropped).toEqual([
      familiar[0]?.id,
      demoted[0]?.id,
      recalled.find((c) => c.object === 'drop-low')?.id,
    ]);
    expect(ranked.map((r) => r.claim.object)).toEqual(['keep-high']);
  });

  it('never trims honesty notes', () => {
    const victim = mkClaim({ object: 'TypeScript', status: 'contradicted' });
    const rows: RankedClaim[] = [
      {
        claim: victim,
        fusedScore: 0.5,
        surfaces: ['lexical'],
        disposition: 'recalled',
        demoted: true,
        reasons: [],
      },
    ];
    const notes: ComparisonNote[] = [
      {
        kind: 'contradicted',
        claimId: victim.id,
        subject: 'user',
        predicate: 'prefers',
        object: 'TypeScript',
        origin: 'user',
        relatedIds: [],
      },
    ];
    const { band } = applyBandBudget(rows, notes, { maxTokens: 1 });
    // Rows all dropped; the contradicted note survives.
    expect(band).toContain('[contradicted]');
  });
});

describe('buildKbBand', () => {
  it('renders hits labeled, omits empty bands', () => {
    expect(buildKbBand([], false)).toBeNull();
    expect(buildKbBand([], true)).toBeNull();
    const band = buildKbBand(
      [{ id: 'kb-1', score: 0.7, snippet: 'corpus fact' }],
      true,
    );
    expect(band).toContain('[knowledge-base: corpus-owned, not user speech]');
    expect(band).toContain('corpus fact');
  });
});
