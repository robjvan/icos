import type { ClaimOrigin } from './claim';

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
