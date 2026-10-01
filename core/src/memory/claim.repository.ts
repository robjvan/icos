import type {
  Claim,
  ClaimCategory,
  ClaimEvidence,
  ClaimOrigin,
  ClaimStatus,
  NewClaim,
} from './claim';
import type { Triple } from './claim-identity';

/**
 * Belief-store boundary. Persists claims derived from the evidence
 * ledger — it never extracts, never promotes on its own, and never
 * touches ledger rows. M10d may add a vector-backed implementation
 * behind this same interface; consumers must not assume SQLite.
 */
export abstract class ClaimRepository {
  abstract createClaim(claim: NewClaim): Promise<Claim>;

  abstract getClaim(id: string): Promise<Claim | null>;

  /** Find by normalized triple identity (dedup / convergence). */
  abstract findByTriple(
    triple: Triple & { negated?: boolean },
  ): Promise<Claim | null>;

  /**
   * Conflict lookup: claims sharing normalized subject+predicate
   * regardless of object, newest-touch first. The CONTRADICT
   * derivation works from this set.
   */
  abstract findBySubjectPredicate(
    subject: string,
    predicate: string,
  ): Promise<Claim[]>;

  /**
   * REINFORCE: append evidence, touch lastSurfacedAt, bump
   * timesObserved. Never rewrites firstAssertedAt or origin.
   */
  abstract appendEvidence(
    id: string,
    evidence: ClaimEvidence[],
    confidence: number,
  ): Promise<Claim | null>;

  /**
   * Status transition with lifecycle enforcement:
   * candidate → active, active → contradicted, any → retired.
   * Returns null when the claim is missing or the transition illegal.
   */
  abstract setStatus(id: string, status: ClaimStatus): Promise<Claim | null>;

  abstract listClaims(options?: {
    status?: ClaimStatus;
    category?: ClaimCategory;
    origin?: ClaimOrigin;
    limit?: number;
  }): Promise<Claim[]>;

  /**
   * M12 access observation: bump `accessCount` and touch
   * `lastAccessedAt` for claims surfaced in a turn. The single
   * mutation M11 is allowed — M12 owns its meaning, and nothing
   * else here writes beliefs. Missing ids are ignored.
   */
  abstract recordAccessed(ids: string[]): Promise<void>;

  /**
   * M12 confidence write: set the engine estimate with lifecycle
   * intact (no status change, no provenance touch). The caller
   * records the matching history row — confidence never moves
   * without audit. Returns null when the claim is missing.
   */
  abstract adjustConfidence(
    id: string,
    confidence: number,
  ): Promise<Claim | null>;

  /**
   * M12 certainty lock: freeze (`true`) or release (`false`) the
   * reserved `locked` flag. Lock guards decay, never revision —
   * evidence still wins. The caller records lock/unlock history.
   * Returns null when the claim is missing.
   */
  abstract setLocked(id: string, locked: boolean): Promise<Claim | null>;

  /**
   * M12 source classification: stamp the reserved `sourceType`
   * once (direct_statement | inference | speculation). The caller
   * records the classify history row. Returns null when missing.
   */
  abstract setSourceType(id: string, sourceType: string): Promise<Claim | null>;

  /**
   * M12d activation write: set salience directly (clamped [0, 1]
   * by the caller). Activation is orthogonal to confidence — this
   * never gates recall, never promotes. The caller records the
   * activate history row. Returns null when the claim is missing.
   */
  abstract setActivation(id: string, activation: number): Promise<Claim | null>;

  /**
   * M12 cross-link maintenance: append claim ids to `related[]`
   * (deduped, order-stable). Reserved refs become traversal
   * substrate here — M11 promised to read, never to write.
   * Returns null when the claim is missing.
   */
  abstract addRelated(id: string, relatedIds: string[]): Promise<Claim | null>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
