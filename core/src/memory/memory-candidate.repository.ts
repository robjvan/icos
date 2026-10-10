import type { MemoryCandidate, NewMemoryCandidate } from './memory-candidate';

/**
 * Ledger ordering (M20g). `recent` is insertion order (the historical
 * default); the rest rank by a stored signal, newest breaking ties.
 */
export type CandidateSort =
  'recent' | 'confidence' | 'importance' | 'stability';

export const CANDIDATE_SORTS: readonly CandidateSort[] = [
  'recent',
  'confidence',
  'importance',
  'stability',
];

/**
 * Evidence-ledger boundary. Persists extraction observations with
 * provenance — it never judges, promotes, or consolidates them.
 * That is future epistemic work.
 */
export abstract class MemoryCandidateRepository {
  abstract saveCandidates(
    candidates: NewMemoryCandidate[],
  ): Promise<MemoryCandidate[]>;

  /** Fetch one ledger row by id; null when unknown (never invent). */
  abstract getCandidate(id: string): Promise<MemoryCandidate | null>;

  abstract listCandidates(
    sessionId?: string,
    options?: { limit?: number; sort?: CandidateSort },
  ): Promise<MemoryCandidate[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
