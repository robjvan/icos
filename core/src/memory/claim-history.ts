/** M12 maintenance transitions (append-only; never rewritten). */
export type ClaimTransition =
  | 'compound'
  | 'decay'
  | 'revise'
  | 'retire'
  | 'link'
  | 'gist_proposed'
  | 'lock'
  | 'unlock'
  | 'suppress';

export const CLAIM_TRANSITIONS: readonly ClaimTransition[] = [
  'compound',
  'decay',
  'revise',
  'retire',
  'link',
  'gist_proposed',
  'lock',
  'unlock',
  'suppress',
];

export interface NewClaimHistory {
  claimId: string;
  transition: ClaimTransition;
  /** Machine-readable context (levels, sibling ids, rules fired). */
  detail: Record<string, unknown>;
  confidenceBefore: number | null;
  confidenceAfter: number | null;
}

export interface ClaimHistory extends NewClaimHistory {
  id: string;
  createdAt: string;
}
