import type { ClaimOrigin } from './claim';

/**
 * Mirrors core prospective items (`core/src/memory/prospective-item.ts`):
 * parked clarification questions over conflicting beliefs. Storage half
 * of the M10e loop — evidence a question exists, not a demand. Rows
 * are read-only here; denial/ignore leaves them parked.
 */
export type ProspectiveTrigger = 'confidence_drop' | 'repeated_contest';

export type ProspectiveStatus = 'open' | 'dismissed';

/** One side of a parked disagreement. */
export interface ProspectiveOption {
  readonly object: string;
  readonly origin: ClaimOrigin;
  readonly confidence: number;
  readonly claimId: string;
}

export interface ProspectiveItem {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly options: readonly ProspectiveOption[];
  readonly contestCount: number;
  readonly trigger: ProspectiveTrigger;
  readonly suggestedQuestion: string;
  readonly status: ProspectiveStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Mirrors core `GET /core/prospective?status=&limit=` response. */
export interface ListProspectiveResponse {
  readonly items: ProspectiveItem[];
}
