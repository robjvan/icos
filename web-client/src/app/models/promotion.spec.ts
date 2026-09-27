import { describe, expect, it } from 'vitest';

import {
  contradictsClaimId,
  reviewState,
  willContradict,
  type PromotionQueueItem,
} from './promotion';

function item(overrides: Partial<PromotionQueueItem>): PromotionQueueItem {
  return {
    id: 'j1',
    candidateId: 'c1',
    operation: 'NEW',
    state: 'proposed',
    approvalId: 'a1',
    claimId: null,
    detail: '',
    createdAt: 't',
    updatedAt: 't',
    approvalStatus: 'pending',
    ...overrides,
  };
}

describe('reviewState', () => {
  it('derives PENDING for open rows with a pending approval', () => {
    expect(reviewState(item({}))).toBe('PENDING');
    expect(reviewState(item({ state: 'promoting' }))).toBe('PENDING');
  });

  it('derives AWAITING_SWEEP once authority is recorded but not executed', () => {
    expect(reviewState(item({ approvalStatus: 'approved' }))).toBe('AWAITING_SWEEP');
    expect(reviewState(item({ state: 'promoting', approvalStatus: 'approved' }))).toBe(
      'AWAITING_SWEEP',
    );
  });

  it('derives APPROVED for committed rows with an approval', () => {
    expect(
      reviewState(item({ state: 'committed', claimId: 'claim-1', approvalStatus: 'approved' })),
    ).toBe('APPROVED');
  });

  it('derives AUTO for committed rows without an approval', () => {
    expect(
      reviewState(item({ state: 'committed', approvalId: null, claimId: 'claim-1' })),
    ).toBe('AUTO');
  });

  it('derives REJECTED for denials and rejected/cancelled approvals', () => {
    expect(reviewState(item({ state: 'denied', approvalStatus: 'rejected' }))).toBe('REJECTED');
    expect(reviewState(item({ approvalStatus: 'rejected' }))).toBe('REJECTED');
    expect(reviewState(item({ approvalStatus: 'cancelled' }))).toBe('REJECTED');
  });

  it('derives FAILED for failed rows with the detail intact', () => {
    const failed = item({ state: 'failed', detail: 'missing_candidate' });
    expect(reviewState(failed)).toBe('FAILED');
    expect(failed.detail).toBe('missing_candidate');
  });
});

describe('willContradict', () => {
  it('flags CONTRADICT operations and intent notes', () => {
    expect(willContradict(item({ operation: 'CONTRADICT' }))).toBe(true);
    expect(willContradict(item({ detail: 'intent:CONTRADICT' }))).toBe(true);
    expect(willContradict(item({ detail: 'contradicts:claim-9' }))).toBe(true);
  });

  it('stays quiet for plain NEW rows', () => {
    expect(willContradict(item({}))).toBe(false);
  });
});

describe('contradictsClaimId', () => {
  it('extracts the contested claim id from post-commit notes', () => {
    expect(contradictsClaimId(item({ detail: 'contradicts:claim-9' }))).toBe('claim-9');
  });

  it('returns null pre-commit or without a note', () => {
    expect(contradictsClaimId(item({ operation: 'CONTRADICT' }))).toBeNull();
    expect(contradictsClaimId(item({}))).toBeNull();
  });
});
