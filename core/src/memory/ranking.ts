/**
 * Ranking primitives (M11b). Pure functions — policy constants live
 * here in the open, tunable without touching the pipeline. No
 * model judgment, no hidden weights.
 */

/** RRF damping constant (standard 60). */
export const RRF_K = 60;

/** Contradicted claims keep recallability at half fused weight. */
export const CONTRADICTED_DEMOTE = 0.5;

/** Recency gradient scale: boost halves every 30 days of age. */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Default recalled band width (M11e budgets refine this). */
export const DEFAULT_RECALLED_LIMIT = 5;

/** Default near-miss band width. */
export const DEFAULT_FAMILIAR_LIMIT = 3;

export type RankDisposition = 'recalled' | 'familiar' | 'unranked' | 'excluded';

export type ExcludeReason = 'gate' | 'lens' | 'duplicate' | 'beyond_limits';

/**
 * Reciprocal-rank fusion over 1-based per-surface ranks.
 * Order-only: raw surface scores never mix (BM25 rank vs vector
 * distance vs resonance count share no scale — RRF is the honest
 * combiner).
 */
export function rrfFuse(ranks: number[]): number {
  return ranks.reduce((sum, rank) => sum + 1 / (RRF_K + rank), 0);
}

/** Whole days from an ISO timestamp to now, clamped at zero. */
export function ageDaysBetween(nowMs: number, thenIso: string): number {
  const then = Date.parse(thenIso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (nowMs - then) / 86_400_000);
}

/**
 * Recency gradient — a true curve, not buckets:
 * fresh evidence scores ~1, decaying toward 0 with age.
 */
export function recencyBoost(ageDays: number): number {
  return 1 / (1 + Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
}
