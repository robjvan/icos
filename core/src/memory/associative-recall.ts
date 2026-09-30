import { Injectable } from '@nestjs/common';
import type { Claim } from './claim';
import { ClaimRepository } from './claim.repository';
import { tokenize } from './text-tokens';

export interface AssociativeHit {
  claimId: string;
  /** Resonance score, higher is closer (0 excluded — no hit). */
  score: number;
}

/** Bounded full-scan width (scale note below). */
const MAX_SCAN_CLAIMS = 200;

/** Exact token overlap weight. */
const EXACT_WEIGHT = 1;

/** Prefix-partial weight (either direction, longest-token guard). */
const PARTIAL_WEIGHT = 0.5;

/** Minimum token length for partial matching (kills single-letter noise). */
const MIN_PARTIAL_LENGTH = 3;

/**
 * Claim text for resonance: the triple plus flat entities. Status,
 * confidence, and provenance never enter the score — resonance is
 * about linkage, M11b gates decide recall.
 */
export function resonanceText(claim: Claim): string {
  return [claim.subject, claim.predicate, claim.object, ...claim.entities].join(
    ' ',
  );
}

/**
 * HRR-lite resonance between query tokens and one claim's tokens.
 * Exact overlap at full weight; prefix-partial (either direction, a
 * nod to v2's partial-match resonance) at half. Deterministic,
 * symmetric in scoring, zero model judgment.
 */
export function resonanceScore(
  queryTokens: string[],
  claimTokens: string[],
): number {
  const claimSet = new Set(claimTokens);
  let score = 0;
  for (const token of new Set(queryTokens)) {
    if (claimSet.has(token)) {
      score += EXACT_WEIGHT;
      continue;
    }
    if (token.length >= MIN_PARTIAL_LENGTH) {
      for (const candidate of claimSet) {
        if (
          candidate.length >= MIN_PARTIAL_LENGTH &&
          (candidate.startsWith(token) || token.startsWith(candidate))
        ) {
          score += PARTIAL_WEIGHT;
          break;
        }
      }
    }
  }
  return score;
}

/**
 * Associative recall surface (M11a): what *feels linked*, not what
 * matches. Stateless full scan over the bounded newest claim window
 * — no token table, no backfill, no commit hooks. The bound
 * (newest-first 200) is the scale contract: past it, this surface
 * needs the dedicated token table M10a deferred, and the bound
 * itself must surface in the trace (M11d) rather than silently
 * narrowing recall. Resonance > 0 is a hit; M11b owns gating.
 */
@Injectable()
export class AssociativeRecall {
  constructor(private readonly claims: ClaimRepository) {}

  async recallAssociative(
    queryTokens: string[],
    k: number,
  ): Promise<AssociativeHit[]> {
    if (queryTokens.length === 0) return [];
    const claims = await this.claims.listClaims({ limit: MAX_SCAN_CLAIMS });
    const scored = claims.flatMap((claim) => {
      const score = resonanceScore(queryTokens, tokenize(resonanceText(claim)));
      return score > 0 ? [{ claimId: claim.id, score }] : [];
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(k, 1));
  }
}
