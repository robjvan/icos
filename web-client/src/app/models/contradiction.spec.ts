import { describe, expect, it } from 'vitest';

import type { Claim } from './claim';
import type { PromotionJournalEntry } from './promotion';
import type { ProspectiveItem } from './prospective';
import {
  contradictionPairs,
  counterpartClaim,
  pairFor,
  prospectiveFor,
} from './contradiction';

describe('contradictionPairs', () => {
  const row = (
    overrides: Partial<PromotionJournalEntry> = {},
  ): PromotionJournalEntry => ({
    id: 'j1',
    candidateId: 'c1',
    operation: 'CONTRADICT',
    state: 'committed',
    approvalId: 'a1',
    claimId: 'winner-1',
    detail: 'contradicts:loser-1',
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  });

  it('pairs committed CONTRADICT rows winner to loser', () => {
    expect(contradictionPairs([row()])).toEqual([
      { loserId: 'loser-1', winnerId: 'winner-1' },
    ]);
  });

  it('ignores non-committed rows, other operations, and noteless rows', () => {
    const rows = [
      row({ id: 'j2', state: 'proposed', operation: 'CONTRADICT' }),
      row({ id: 'j3', operation: 'NEW', detail: '' }),
      row({ id: 'j4', detail: '' }),
      row({ id: 'j5', claimId: null }),
    ];
    expect(contradictionPairs(rows)).toEqual([]);
  });
});

describe('pairFor', () => {
  const pairs = [
    { loserId: 'loser-1', winnerId: 'winner-1' },
  ] as const;

  it('resolves both directions', () => {
    expect(pairFor('loser-1', [...pairs])).toEqual({
      counterpartId: 'winner-1',
      direction: 'contradicted-by',
    });
    expect(pairFor('winner-1', [...pairs])).toEqual({
      counterpartId: 'loser-1',
      direction: 'contradicts',
    });
  });

  it('returns null when unpaired', () => {
    expect(pairFor('other', [...pairs])).toBeNull();
    expect(pairFor('loser-1', [])).toBeNull();
  });
});

describe('prospectiveFor', () => {
  const item = (overrides: Partial<ProspectiveItem> = {}): ProspectiveItem => ({
    id: 'p1',
    subject: 'user',
    predicate: 'prefers',
    options: [
      { object: 'A', origin: 'user', confidence: 0.9, claimId: 'winner-1' },
      { object: 'B', origin: 'user', confidence: 0.9, claimId: 'loser-1' },
    ],
    contestCount: 2,
    trigger: 'repeated_contest',
    suggestedQuestion: 'Which should be kept?',
    status: 'open',
    resolution: null,
    resolvedAt: null,
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  });

  it('matches open items by option claim id', () => {
    const items = [item()];
    expect(prospectiveFor('winner-1', items)?.id).toBe('p1');
    expect(prospectiveFor('loser-1', items)?.id).toBe('p1');
    expect(prospectiveFor('other', items)).toBeNull();
  });

  it('skips dismissed items', () => {
    expect(
      prospectiveFor('winner-1', [item({ status: 'dismissed' })]),
    ).toBeNull();
  });
});

describe('counterpartClaim', () => {
  it('resolves from the list, null when missing', () => {
    const claims = [
      { id: 'winner-1', object: 'Rust' },
    ] as unknown as Claim[];
    expect(counterpartClaim('winner-1', claims)?.object).toBe('Rust');
    expect(counterpartClaim('missing', claims)).toBeNull();
  });
});
