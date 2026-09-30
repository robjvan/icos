/**
 * Mirrors core journal types (`core/src/memory/promotion.ts`): one row per
 * proposed candidate, approval id as idempotency key, terminal states
 * (committed/denied/failed) never transition. Approval state arrives
 * joined (`approvalStatus`); null means automatic promotion, 'missing'
 * means the approval row vanished.
 */
export type PromotionOperation = 'NEW' | 'REINFORCE' | 'CONTRADICT';

export type JournalState = 'proposed' | 'promoting' | 'committed' | 'denied' | 'failed';

export interface PromotionJournalEntry {
  readonly id: string;
  readonly candidateId: string;
  /** Intent at proposal; updated to the actual operation on commit. */
  readonly operation: PromotionOperation;
  readonly state: JournalState;
  /** Null for automatic promotions (default-off, config-gated). */
  readonly approvalId: string | null;
  readonly claimId: string | null;
  /** Intent-vs-actual notes, conflict ids, failure reasons. */
  readonly detail: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PromotionQueueItem extends PromotionJournalEntry {
  readonly approvalStatus: string | null;
}

export interface SweepSummary {
  readonly new: number;
  readonly reinforced: number;
  readonly contradicted: number;
  readonly denied: number;
  readonly failed: number;
  readonly skipped: number;
}

/** Mirrors core `POST /core/promotions/run` response. */
export interface RunPromotionsResponse {
  readonly summary: SweepSummary;
}

/** Mirrors core `GET /core/promotions/pending` response. */
export interface ListPendingPromotionsResponse {
  readonly pending: PromotionQueueItem[];
}

/** Mirrors core `GET /core/promotions?state=&limit=` response. */
export interface ListPromotionsResponse {
  readonly promotions: PromotionQueueItem[];
  /** Total rows matching the state filter, before the limit. */
  readonly total: number;
}

/**
 * Review disposition (Axis A in the Phase 4 plan): the journal row plus
 * its approval, derived into one actionable state. Amber belongs to
 * contradicted *claims* (Axis B); the pending ramp here stays neutral
 * except the two honest warnings (AWAITING_SWEEP, FAILED).
 */
export type ReviewState =
  | 'PENDING'
  | 'AWAITING_SWEEP'
  | 'APPROVED'
  | 'AUTO'
  | 'REJECTED'
  | 'FAILED';

/**
 * Derive the review state from one journal row and its joined approval
 * status. Pure function — the §5 Axis A table in one tested place, no
 * switch duplicated across templates.
 */
export function reviewState(item: PromotionQueueItem): ReviewState {
  if (item.state === 'failed') {
    return 'FAILED';
  }
  if (item.state === 'denied') {
    return 'REJECTED';
  }
  if (item.state === 'committed') {
    if (item.approvalId === null) {
      return 'AUTO';
    }
    return 'APPROVED';
  }
  if (item.approvalStatus === 'approved') {
    return 'AWAITING_SWEEP';
  }
  if (
    item.approvalStatus === 'rejected' ||
    item.approvalStatus === 'cancelled'
  ) {
    return 'REJECTED';
  }
  return 'PENDING';
}

/**
 * True when the row will contradict an existing claim on commit —
 * the one place the two axes meet. Journal `operation` is intent at
 * proposal; `detail` carries the post-commit target (`contradicts:<id>`).
 */
export function willContradict(item: PromotionQueueItem): boolean {
  if (item.operation === 'CONTRADICT') {
    return true;
  }
  return /(^|[\s;])contradicts:/.test(item.detail) || item.detail.includes('intent:CONTRADICT');
}

/**
 * Extract the contested claim id from a post-commit `contradicts:<id>`
 * detail note. Null pre-commit (no target assigned yet) or when the
 * detail carries no contradicts note.
 */
export function contradictsClaimId(item: PromotionQueueItem): string | null {
  const match = /(?:^|[\s;])contradicts:([^\s;]+)/.exec(item.detail);
  return match?.[1] ?? null;
}
