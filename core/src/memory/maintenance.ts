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

export type MaintenanceOutcome =
  'compounded' | 'linked' | 'gist_proposed' | 'skipped' | 'failed';

export interface PassSummary {
  compounded: number;
  linked: number;
  gistProposed: number;
  skipped: number;
  failed: number;
  /** Wall-clock ms for the M12f latency evidence. */
  durationMs: number;
}

export const EMPTY_PASS: PassSummary = {
  compounded: 0,
  linked: 0,
  gistProposed: 0,
  skipped: 0,
  failed: 0,
  durationMs: 0,
};
