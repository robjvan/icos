import type {
  ClaimHistory,
  ClaimTransition,
  NewClaimHistory,
} from './claim-history';

/**
 * Maintenance-history boundary. Append-only audit of belief aging:
 * one row per record per transition, confidence before/after where
 * the transition moves it. Readers re-derive aging levels from
 * these rows (no per-claim aging columns — a crash replays instead
 * of half-applying).
 */
export abstract class ClaimHistoryRepository {
  abstract record(entry: NewClaimHistory): Promise<ClaimHistory>;

  abstract listByClaimId(claimId: string): Promise<ClaimHistory[]>;

  /** Latest row of one transition type (level re-derivation). */
  abstract latestByClaimAndTransition(
    claimId: string,
    transition: ClaimTransition,
  ): Promise<ClaimHistory | null>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
