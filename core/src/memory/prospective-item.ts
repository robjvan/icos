import type { ClaimOrigin } from './claim';
import type { Claim } from './claim';

/** Why promotion parked this question. */
export type ProspectiveTrigger = 'confidence_drop' | 'repeated_contest';

export const PROSPECTIVE_TRIGGERS: readonly ProspectiveTrigger[] = [
  'confidence_drop',
  'repeated_contest',
];

export type ProspectiveStatus = 'open' | 'dismissed';

export const PROSPECTIVE_STATUSES: readonly ProspectiveStatus[] = [
  'open',
  'dismissed',
];

/** One side of a parked disagreement. */
export interface ProspectiveOption {
  object: string;
  origin: ClaimOrigin;
  confidence: number;
  claimId: string;
}

export interface NewProspectiveItem {
  subject: string;
  predicate: string;
  options: ProspectiveOption[];
  /** How many contradictions produced this row (merge bumps it). */
  contestCount: number;
  trigger: ProspectiveTrigger;
  suggestedQuestion: string;
}

/**
 * A parked clarification question: conflicting beliefs about one
 * subject+predicate, with their origins and confidences, plus a
 * deterministic suggested phrasing. Storage half of the M10e
 * clarification loop — evidence that a question exists, not a demand.
 * Nothing retries, nothing nags, and no turn-time behavior reads
 * these rows (surfacing is later work, not M10).
 */
export interface ProspectiveItem extends NewProspectiveItem {
  id: string;
  status: ProspectiveStatus;
  createdAt: string;
  updatedAt: string;
}

/** A parked option built from a live claim (origin + confidence ride along). */
export function prospectiveOptionFromClaim(claim: Claim): ProspectiveOption {
  return {
    object: claim.object,
    origin: claim.origin,
    confidence: claim.confidence,
    claimId: claim.id,
  };
}

/**
 * Deterministic clarification phrasing for a parked (or proposed)
 * contest. A template, never model output: every option's value,
 * origin, and confidence is listed so the question is answerable
 * from the row alone. Shared by promotion (M10e parking) and recall
 * comparison (M11c proposals) so both paths ask identically.
 */
export function suggestProspectiveQuestion(
  subject: string,
  predicate: string,
  options: ProspectiveOption[],
): string {
  const sides = options
    .map(
      (option) =>
        `"${option.object}" (origin ${option.origin}, ` +
        `confidence ${option.confidence.toFixed(2)})`,
    )
    .join(' vs ');
  return (
    `Conflicting beliefs about ${subject} ${predicate}: ` +
    `${sides}. Which should be kept?`
  );
}
