import type { Claim } from './claim';
import { compareRecalled } from './comparison';
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
  claims.map((claim, index) => ({
    claim,
    fusedScore: 1 - index * 0.1,
    surfaces: ['lexical' as const],
    disposition,
    demoted: claim.status === 'contradicted',
    reasons: [],
  }));

describe('compareRecalled', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('notes active rival pairs with both origins and proposes a question', () => {
    const a = mkClaim({ object: 'TypeScript' });
    const b = mkClaim({ object: 'Rust', origin: 'agent' });

    const { notes, proposedQuestions } = compareRecalled(ranked([a, b]));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: 'conflict',
      subject: 'user',
      predicate: 'prefers',
    });
    if (notes[0]?.kind !== 'conflict') throw new Error('unreachable');
    expect(notes[0].parties).toMatchObject([
      { claimId: a.id, object: 'TypeScript', origin: 'user' },
      { claimId: b.id, object: 'Rust', origin: 'agent' },
    ]);
    expect(proposedQuestions).toHaveLength(1);
    expect(proposedQuestions[0]).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
    });
    expect(proposedQuestions[0]?.options).toHaveLength(2);
    expect(proposedQuestions[0]?.suggestedQuestion).toContain('TypeScript');
    expect(proposedQuestions[0]?.suggestedQuestion).toContain('Rust');
  });

  it('notes contradicted pairs without proposing (history recorded it)', () => {
    const old = mkClaim({ object: 'TypeScript', status: 'contradicted' });
    const current = mkClaim({ object: 'Rust' });

    const { notes, proposedQuestions } = compareRecalled(
      ranked([current, old]),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('conflict');
    expect(proposedQuestions).toEqual([]);
  });

  it('notes lone contradictions with no rival in the set', () => {
    const old = mkClaim({ object: 'TypeScript', status: 'contradicted' });
    const unrelated = mkClaim({
      subject: 'user',
      predicate: 'likes',
      object: 'tea',
    });

    const { notes, proposedQuestions } = compareRecalled(
      ranked([old, unrelated]),
    );
    expect(notes).toMatchObject([
      {
        kind: 'contradicted',
        claimId: old.id,
        object: 'TypeScript',
        origin: 'user',
      },
    ]);
    expect(proposedQuestions).toEqual([]);
  });

  it('stays silent without disagreement', () => {
    const a = mkClaim({ object: 'TypeScript' });
    // Same triple text, same marker: one belief, no conflict.
    const twin = mkClaim({ object: '  TYPESCRIPT ' });

    expect(compareRecalled(ranked([a, twin]))).toEqual({
      notes: [],
      proposedQuestions: [],
    });
    expect(compareRecalled(ranked([a], 'familiar'))).toEqual({
      notes: [],
      proposedQuestions: [],
    });
  });

  it('notes same-text opposite-marker rivals as a conflict', () => {
    const affirmed = mkClaim({ object: 'TypeScript', negated: false });
    const denied = mkClaim({ object: 'TypeScript', negated: true });

    const { notes, proposedQuestions } = compareRecalled(
      ranked([affirmed, denied]),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('conflict');
    if (notes[0]?.kind !== 'conflict') throw new Error('unreachable');
    expect(notes[0].parties).toMatchObject([
      { claimId: affirmed.id, negated: false },
      { claimId: denied.id, negated: true },
    ]);
    // Both active: a live disagreement the turn cannot resolve.
    expect(proposedQuestions).toHaveLength(1);
  });

  it('passes reserved refs through without walking them', () => {
    const a = mkClaim({ object: 'TypeScript', related: ['claim-zzz'] });
    const b = mkClaim({ object: 'Rust' });

    const { notes } = compareRecalled(ranked([a, b]));
    expect(notes[0]).toMatchObject({ relatedIds: ['claim-zzz'] });
  });
});
