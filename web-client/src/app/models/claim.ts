import type { MemoryCandidateKind } from './memory-candidate';

/** Which side of the turn the evidence was mined from. */
export type ClaimOrigin = 'user' | 'agent';

export type ClaimCategory = 'fact' | 'preference' | 'relationship' | 'procedure';

export type ClaimStatus = 'candidate' | 'active' | 'contradicted' | 'retired';

/**
 * One evidence item behind a claim: a ledger reference plus the origin
 * it carried. References, never copies. 'unknown' only for pre-role-stamp
 * ledger rows; never defaulted.
 */
export interface ClaimEvidence {
  readonly candidateId: string;
  readonly role: 'user' | 'assistant' | 'unknown';
}

/**
 * Mirrors core `Claim` (`core/src/memory/claim.ts`), including reserved
 * fields as present-but-unused (later milestones need no migration).
 */
export interface Claim {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: ClaimCategory;
  readonly status: ClaimStatus;
  /** Extractor's number, stored as observed — never re-estimated. */
  readonly extractorConfidence: number;
  /** Engine estimate, re-estimated on evidence change. */
  readonly confidence: number;
  /** Originating evidence reference (a candidate id, not a timestamp). */
  readonly firstAssertedAt: string;
  /** Most recent supporting evidence reference (a candidate id). */
  readonly lastSurfacedAt: string;
  readonly origin: ClaimOrigin;
  /**
   * M10e negation marker (mirrors core). True when the belief denies
   * its own triple. Affirmation and negation coexist as rival rows.
   */
  readonly negated: boolean;
  readonly evidence: readonly ClaimEvidence[];
  readonly entities: readonly string[];
  readonly promotion: string;
  readonly sourceType: string | null;
  readonly summary: string | null;
  readonly related: readonly string[];
  readonly timesObserved: number;
  readonly accessCount: number;
  readonly lastAccessedAt: string | null;
  readonly activation: number | null;
  readonly locked: boolean;
  readonly emotional: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Mirrors core `GET /core/claims` response. */
export interface ListClaimsResponse {
  readonly claims: Claim[];
}

/** Mirrors core `GET /core/claims/:id` response. */
export interface ClaimDetailResponse {
  readonly claim: Claim;
  /** Resolved evidence rows; null only if the ledger lost a row. */
  readonly evidence: (import('./memory-candidate').MemoryCandidate | null)[];
  /** Journal rows that built or touched this claim, oldest first. */
  readonly history: readonly import('./promotion').PromotionJournalEntry[];
}

/** Mirrors core `GET /core/claims/search?q=&k=` response. */
export interface SearchClaimsResponse {
  readonly results: (Claim & { readonly score: number })[];
  readonly degraded: boolean;
  readonly reason?: string;
}

/** Claim list filters. Mirrors the core query DTO: status/category/origin/limit — not kind. */
export interface ClaimFilters {
  readonly status?: ClaimStatus;
  readonly category?: ClaimCategory;
  readonly origin?: ClaimOrigin;
  readonly limit?: number;
}

/**
 * Claim lifecycle tone (Axis B in the Phase 4 plan): one tested mapping
 * from status to presentation, no switch duplicated across templates.
 */
export type ClaimTone = 'active' | 'candidate' | 'contradicted' | 'retired';

export function claimTone(status: ClaimStatus): ClaimTone {
  switch (status) {
    case 'active':
      return 'active';
    case 'contradicted':
      return 'contradicted';
    case 'retired':
      return 'retired';
    case 'candidate':
      return 'candidate';
  }
}

/** Map a candidate kind onto a claim category (default: fact). */
export function categoryFromKind(kind: MemoryCandidateKind): ClaimCategory {
  switch (kind) {
    case 'preference':
      return 'preference';
    case 'relationship':
      return 'relationship';
    default:
      return 'fact';
  }
}

/**
 * Render a claim's object with its negation marker: affirmed rows
 * read `"X"`, negated rows `not "X"`. Affirmed vs negated rivals
 * share triple text — without the marker they render identically,
 * which is the Phase 5 item-4 bug. Pure function, one tested place.
 */
export function claimObjectLabel(claim: Pick<Claim, 'object' | 'negated'>): string {
  return claim.negated ? `not "${claim.object}"` : `"${claim.object}"`;
}

/** Full belief statement with the negation marker included. */
export function claimStatement(
  claim: Pick<Claim, 'subject' | 'predicate' | 'object' | 'negated'>,
): string {
  return `${claim.subject} ${claim.predicate} ${claimObjectLabel(claim)}`;
}
