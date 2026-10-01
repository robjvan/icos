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
 * Source-influence factor from a win/loss record (M12c reliability).
 * Laplace-smoothed, punishment-only: neutral and winning records
 * map to 1.0 (no boost, never rewards), losing records decay
 * toward 0.5. M11 ranking multiplies fused scores by this.
 */
export function reliabilityFactor(wins: number, losses: number): number {
  const estimate = (wins + 1) / (wins + losses + 2);
  return Math.min(1, 0.5 + estimate);
}
