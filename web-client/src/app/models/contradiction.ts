import type { Claim } from './claim';
import type { PromotionJournalEntry } from './promotion';
import type { ProspectiveItem } from './prospective';

/**
 * Contradiction pairing (Phase 5): which claim contradicted which,
 * derived from committed journal rows — never inferred from text.
 * A `CONTRADICT/committed` row names the winner (`claimId`) and the
 * loser (`contradicts:<id>` in `detail`, parsed by
 * `contradictsClaimId`). Both directions resolve from one journal
 * fetch; a counterpart missing from the claim list renders by id.
 */
export interface ContradictionPair {
  readonly loserId: string;
  readonly winnerId: string;
}

export function contradictionPairs(
  journal: readonly PromotionJournalEntry[],
): readonly ContradictionPair[] {
  const pairs: ContradictionPair[] = [];
  for (const row of journal) {
    if (row.operation !== 'CONTRADICT' || row.state !== 'committed') {
      continue;
    }
    if (row.claimId === null) {
      continue;
    }
    const match = /(?:^|[\s;])contradicts:([^\s;]+)/.exec(row.detail);
    const loserId = match?.[1];
    if (!loserId) {
      continue;
    }
    pairs.push({ loserId, winnerId: row.claimId });
  }
  return pairs;
}

export type PairDirection = 'contradicted-by' | 'contradicts';

export interface ClaimPairView {
  readonly counterpartId: string;
  readonly direction: PairDirection;
}

/** Both directions for one claim id; null when unpaired. */
export function pairFor(
  claimId: string,
  pairs: readonly ContradictionPair[],
): ClaimPairView | null {
  for (const pair of pairs) {
    if (pair.loserId === claimId) {
      return { counterpartId: pair.winnerId, direction: 'contradicted-by' };
    }
    if (pair.winnerId === claimId) {
      return { counterpartId: pair.loserId, direction: 'contradicts' };
    }
  }
  return null;
}

/**
 * Parked questions touching a claim: any open prospective item
 * listing the claim id among its options. A pair shares at most
 * one open item (promotion merges repeat contests into the row).
 */
export function prospectiveFor(
  claimId: string,
  items: readonly ProspectiveItem[],
): ProspectiveItem | null {
  for (const item of items) {
    if (item.status !== 'open') {
      continue;
    }
    if (item.options.some((option) => option.claimId === claimId)) {
      return item;
    }
  }
  return null;
}

/** Short-id rendering for missing counterparts (same 8-char convention). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Resolve a counterpart for display; null when unknown to the list. */
export function counterpartClaim(
  counterpartId: string,
  claims: readonly Claim[],
): Claim | null {
  return claims.find((claim) => claim.id === counterpartId) ?? null;
}
