import type {
  HallucinationFailureMode,
  HallucinationSeverity,
} from './hallucination-modes';

/** The three deterministic outcomes of checking an assertion vs the store. */
export type ClaimConsistency = 'supported' | 'contradicted' | 'novel';

/**
 * An assertion to check — typically a claim the model emitted. It is a
 * triple, not a stored claim: the point is to decide whether the store
 * backs it before it is trusted.
 */
export interface ClaimAssertion {
  subject: string;
  predicate: string;
  object: string;
  /** True when the assertion denies the triple. Defaults to false. */
  negated?: boolean;
  /** Asserted confidence, 0..1, if the output carried one. */
  confidence?: number;
  /** Claim ids the output cites as its own evidence, if any. */
  citedClaimIds?: readonly string[];
}

export interface ClaimFinding {
  mode: HallucinationFailureMode;
  severity: HallucinationSeverity;
  reason: string;
}

export interface ClaimConsistencyResult {
  classification: ClaimConsistency;
  /** The active claim that supports the assertion, when supported. */
  supportingClaimId?: string;
  /** The opposing active claim, when contradicted. */
  contradictingClaimId?: string;
  /** Cited evidence ids that do not resolve to a stored claim. */
  fabricatedClaimIds: string[];
  findings: ClaimFinding[];
  reasons: string[];
}
