/**
 * Maintenance policy constants (M12a). Fixed and documented like
 * M10's confidence rules — auto-tuning is out of scope. Epistemic
 * choices (boost size, ceiling) live here in the open; operational
 * ones (cadence, on/off) live in config.
 */

/** Confidence added per compounding step, scaled by level. */
export const COMPOUND_BOOST = 0.02;

/** timesObserved levels that keep counting (5+ counts as 5). */
export const COMPOUND_LEVEL_CAP = 5;

/** No compounding past this engine confidence. */
export const COMPOUND_CEILING = 0.99;

/** Hard ceiling: confidence never exceeds 1, ever. */
export const CONFIDENCE_MAX = 1;

/** Episode family size that triggers a gist proposal. */
export const GIST_FAMILY_SIZE = 3;

/** Max claims touched per pass (bounded background work). */
export const MAINTENANCE_PASS_LIMIT = 500;

/**
 * Decay policy (M12b). Passive exponential half-life for records
 * unaccessed past a grace period — category-scoped (v2's
 * categorical-lifecycle lesson: tastes fade faster than bonds).
 * Floors hold (decay never deletes); locked claims never decay
 * (certainty guards loss, not growth); recent access shields
 * (v2's mark_accessed: being remembered protects memory —
 * corroboration-free access slows decay but never raises
 * confidence, which stays M12a's job).
 */

/** Neglect days before decay starts ticking. */
export const DECAY_GRACE_DAYS = 30;

/** Base half-life in days (multiplied per category). */
export const DECAY_HALF_LIFE_DAYS = 90;

/** Half-life multipliers by claim category. */
export const DECAY_HALF_LIFE_MULTIPLIER: Record<string, number> = {
  fact: 1.0,
  preference: 0.8,
  relationship: 2.0,
  procedure: 1.5,
};

/** Confidence floors by category — decay stops here, never deletes. */
export const DECAY_FLOOR: Record<string, number> = {
  fact: 0.2,
  preference: 0.15,
  relationship: 0.3,
  procedure: 0.25,
};

/** Access within this many days shields the next decay pass. */
export const ACCESS_SHIELD_DAYS = 7;

/**
 * Deliberate retirement (M12b): unretrieved this many days AND at
 * or below this confidence retires explicitly through the endpoint
 * (`retired` finally gets its writer). An explicit "forget this"
 * instruction takes the same path with force (HITL authority is
 * the caller). Retirement is a status transition with history —
 * never a delete, recoverable in history.
 */
export const RETIRE_AFTER_DAYS = 180;
export const RETIRE_CONFIDENCE_MAX = 0.3;

export type MaintenanceOutcome =
  | 'compounded'
  | 'decayed'
  | 'linked'
  | 'gist_proposed'
  | 'revised'
  | 'locked'
  | 'classified'
  | 'activated'
  | 'suppressed'
  | 'skipped'
  | 'failed';

export interface PassSummary {
  compounded: number;
  decayed: number;
  linked: number;
  gistProposed: number;
  revised: number;
  locked: number;
  classified: number;
  activated: number;
  suppressed: number;
  skipped: number;
  failed: number;
  /** Wall-clock ms for the M12f latency evidence. */
  durationMs: number;
}

export const EMPTY_PASS: PassSummary = {
  compounded: 0,
  decayed: 0,
  linked: 0,
  gistProposed: 0,
  revised: 0,
  locked: 0,
  classified: 0,
  activated: 0,
  suppressed: 0,
  skipped: 0,
  failed: 0,
  durationMs: 0,
};

/**
 * Certainty lock (M12c): corroboration bar + confidence bar. Lock
 * guards decay, never revision — evidence still wins, and a locked
 * claim that loses (contradicted) unlocks with history.
 */
export const LOCK_CORROBORATION_BAR = 5;
export const LOCK_CONFIDENCE_MIN = 0.9;

/**
 * Activation policy (M12d): salience orthogonal to truth
 * (ACT-R lineage — "I keep hearing this, but it's wrong" is a
 * representable state). Retrieval boosts the touched claim and
 * spreads a fan-capped share along `related[]` links; disuse
 * decays in fixed steps on a fast schedule. Bounds are closed
 * [0, 1]; null means never-salienced (no row, no history).
 */
export const ACTIVATION_SELF_BOOST = 0.3;
export const ACTIVATION_FAN_CAP = 5;
export const ACTIVATION_DECAY_STEP = 0.05;
/** Minimum ms between activation decays of one claim. */
export const ACTIVATION_MIN_INTERVAL_MS = 3_600_000;

/**
 * Divergence review (M12d): persistently loud but wrong — high
 * activation against decayed confidence — parks a clarification
 * question. The self-correction mechanism dynamics builds toward.
 */
export const DIVERGENCE_ACTIVATION_MIN = 0.7;
export const DIVERGENCE_CONFIDENCE_MAX = 0.4;

/** Retrieval-shaped suppression step for near-miss competitors. */
export const SUPPRESS_STEP = 0.1;

/**
 * Source-influence factor from a win/loss record (M12c reliability).
 * Laplace-smoothed, punishment-only: neutral and winning records
 * map to 1.0 (no boost, never rewards), losing records decay
 * toward 0.5. M11 ranking multiplies fused scores by this.
 */
export function reliabilityFactor(wins: number, losses: number): number {
  const estimate = (wins + 1) / (wins + losses + 2);
  return Math.min(1, 0.5 + estimate);
}

/** Activation after a retrieval touch (null baseline reads as 0). */
export function activationBoost(current: number | null): number {
  return Math.min(1, (current ?? 0) + ACTIVATION_SELF_BOOST);
}

/** One disuse step toward silence. */
export function activationDecayStep(current: number): number {
  return Math.max(0, current - ACTIVATION_DECAY_STEP);
}

/** Fan-capped neighbor share of a boost (insertion-ordered first N). */
export function spreadShare(fanout: number): number {
  return (
    ACTIVATION_SELF_BOOST / Math.max(1, Math.min(fanout, ACTIVATION_FAN_CAP))
  );
}
