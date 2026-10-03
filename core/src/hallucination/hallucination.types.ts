import type {
  HallucinationFailureMode,
  HallucinationSeverity,
  MitigationStrategy,
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

/** Which verifier answered (M15.5c). */
export type VerificationBackend = 'decision' | 'llm';

export type VerificationVerdictLabel = 'supported' | 'contradicted' | 'unknown';

/**
 * Whether the verifier is a *different* model from the one that spoke.
 * `self` is self-consistency, never independent verification — recorded so
 * evidence never overstates it.
 */
export type VerificationIndependence = 'independent' | 'self' | 'unknown';

export interface VerificationRequest {
  assertion: ClaimAssertion;
  /** A short, provenance-bearing summary of the store's position. */
  evidenceSummary: string;
  /** The model that produced the assertion, when known. */
  speakerModel?: string;
}

export interface VerificationVerdict {
  available: boolean;
  backend: VerificationBackend | null;
  verdict: VerificationVerdictLabel;
  /** Calibrated probability of the chosen verdict, when provided. */
  probability: number | null;
  model: string | null;
  independence: VerificationIndependence;
  detail?: string;
}

export interface ClaimVerificationResult extends ClaimConsistencyResult {
  verification: VerificationVerdict;
  /** True when the verifier disagreed with the deterministic classification. */
  disagreement: boolean;
}

/** A mitigation decision: what to do, and the finding that drove it. */
export interface MitigationPlan {
  strategy: MitigationStrategy;
  trigger: ClaimFinding | null;
  reasons: string[];
}

/** A human-readable rendering of an assertion for a verifier prompt. */
export function describeAssertion(assertion: ClaimAssertion): string {
  const object = assertion.negated
    ? `not ${assertion.object}`
    : assertion.object;
  return `${assertion.subject} ${assertion.predicate} ${object}`.replace(
    /\s+/g,
    ' ',
  );
}
