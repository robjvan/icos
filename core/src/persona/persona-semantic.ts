import { contentTokenList, tokenOverlap } from './persona-similarity';

/**
 * Semantic comparison (M15c): the discrete distributional triad plus the
 * simpler baselines, computed over the content-token distribution.
 *
 * - `cosine` — directional similarity of the token-frequency vectors.
 * - `wasserstein` — the discrete Wasserstein-1 (`½ Σ |p − q|`, unit ground
 *   cost): total mass that must move between the two token distributions.
 * - `entropy` — normalized Shannon entropy of the next distribution
 *   (how diffuse vs concentrated the vocabulary is).
 * - Baselines: `tokenOverlap` (Jaccard) and `editRatio` (Levenshtein).
 *
 * The single `signal` is `max(1 − cosine, wasserstein)` — a divergence in
 * the range [0, 1] — so one number drives the drift floor while the triad
 * and baselines stay visible for the "which measure earns its place"
 * comparison the roadmap asks for.
 */

export type TokenDistribution = Record<string, number>;

export interface SemanticComparison {
  identical: boolean;
  cosine: number;
  wasserstein: number;
  entropy: number;
  tokenOverlap: number;
  editDistance: number;
  editRatio: number;
  signal: number;
}

export function tokenDistribution(value: string): TokenDistribution {
  const distribution: TokenDistribution = {};
  for (const token of contentTokenList(value)) {
    distribution[token] = (distribution[token] ?? 0) + 1;
  }
  return distribution;
}

function total(distribution: TokenDistribution): number {
  return Object.values(distribution).reduce((sum, count) => sum + count, 0);
}

/** Cosine similarity of two token-frequency vectors, in [0, 1]. */
export function cosineSimilarity(
  left: TokenDistribution,
  right: TokenDistribution,
): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (const key of keys) {
    const l = left[key] ?? 0;
    const r = right[key] ?? 0;
    dot += l * r;
    leftMag += l * l;
    rightMag += r * r;
  }
  const magnitude = Math.sqrt(leftMag) * Math.sqrt(rightMag);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Discrete Wasserstein-1 with unit ground cost: 0 for identical
 * distributions, 1 for disjoint point-mass supports. `W1 = ½ Σ |p − q|`.
 */
export function wasserstein1(
  left: TokenDistribution,
  right: TokenDistribution,
): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const leftTotal = total(left);
  const rightTotal = total(right);
  if (leftTotal === 0 && rightTotal === 0) {
    return 0;
  }
  if (leftTotal === 0 || rightTotal === 0) {
    return 1;
  }
  let l1 = 0;
  for (const key of keys) {
    const p = (left[key] ?? 0) / leftTotal;
    const q = (right[key] ?? 0) / rightTotal;
    l1 += Math.abs(p - q);
  }
  return l1 / 2;
}

/** Normalized Shannon entropy of a distribution, in [0, 1]. */
export function normalizedEntropy(distribution: TokenDistribution): number {
  const values = Object.values(distribution);
  const sum = values.reduce((acc, count) => acc + count, 0);
  if (sum === 0) {
    return 0;
  }
  const bins = values.length;
  if (bins <= 1) {
    return 0;
  }
  let entropy = 0;
  for (const count of values) {
    const p = count / sum;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy / Math.log2(bins);
}

/** Levenshtein edit distance between two strings. */
export function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Full comparison of a previous and next content string. */
export function compareContent(
  previous: string,
  next: string,
): SemanticComparison {
  if (previous === next) {
    return {
      identical: true,
      cosine: 1,
      wasserstein: 0,
      entropy: normalizedEntropy(tokenDistribution(next)),
      tokenOverlap: 1,
      editDistance: 0,
      editRatio: 0,
      signal: 0,
    };
  }
  const left = tokenDistribution(previous);
  const right = tokenDistribution(next);
  const cosine = cosineSimilarity(left, right);
  const wasserstein = wasserstein1(left, right);
  const distance = editDistance(previous, next);
  const longest = Math.max([...previous].length, [...next].length);
  return {
    identical: false,
    cosine,
    wasserstein,
    entropy: normalizedEntropy(right),
    tokenOverlap: tokenOverlap(previous, next),
    editDistance: distance,
    editRatio: longest === 0 ? 0 : distance / longest,
    signal: Math.max(1 - cosine, wasserstein),
  };
}

/** Cosine of two embedding vectors, in [-1, 1]; 0 when either is empty. */
export function embeddingCosine(
  left: readonly number[],
  right: readonly number[],
): number {
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    dot += l * r;
    leftMag += l * l;
    rightMag += r * r;
  }
  const magnitude = Math.sqrt(leftMag) * Math.sqrt(rightMag);
  return magnitude === 0 ? 0 : dot / magnitude;
}
