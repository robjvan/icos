import type { Claim, ClaimOrigin } from './claim';
import {
  prospectiveOptionFromClaim,
  suggestProspectiveQuestion,
} from './prospective-item';
import type { RankedClaim } from './rank.service';

/** One side of a recalled disagreement. */
export interface ComparisonParty {
  claimId: string;
  object: string;
  origin: ClaimOrigin;
  confidence: number;
  negated: boolean;
  status: Claim['status'];
}

export type ComparisonNote =
  | {
      kind: 'conflict';
      subject: string;
      predicate: string;
      parties: ComparisonParty[];
      /** Reserved refs, passed through unwalked (M11 reads, never traverses). */
      relatedIds: string[];
    }
  | {
      kind: 'contradicted';
      claimId: string;
      subject: string;
      predicate: string;
      object: string;
      origin: ClaimOrigin;
      relatedIds: string[];
    };

export interface ProposedQuestion {
  subject: string;
  predicate: string;
  options: {
    object: string;
    origin: ClaimOrigin;
    confidence: number;
    claimId: string;
  }[];
  suggestedQuestion: string;
}

export interface ComparisonResult {
  notes: ComparisonNote[];
  /**
   * Questions the turn cannot resolve, proposed — not parked.
   * Recall recommends; M11d (or later) dedupes against open
   * prospective items and decides. Only all-active rival groups
   * propose: a contradicted side already has its history recorded,
   * and re-proposing every confident first contest would unwind
   * M10e's trigger policy.
   */
  proposedQuestions: ProposedQuestion[];
}

function partyOf(claim: Claim): ComparisonParty {
  return {
    claimId: claim.id,
    object: claim.object,
    origin: claim.origin,
    confidence: claim.confidence,
    negated: claim.negated,
    status: claim.status,
  };
}

function relatedOf(claims: Claim[]): string[] {
  const ids = new Set<string>();
  for (const claim of claims) {
    for (const id of claim.related) ids.add(id);
  }
  return [...ids];
}

/**
 * Cross-memory comparison (M11c): recalled claims are never
 * presented in isolation. Same subject+predicate with distinct
 * objects — or the same text with opposite negation markers — yields
 * a conflict note with both origins visible; a lone recalled
 * contradiction yields a contradicted note. Familiar near-misses
 * stay out — comparison speaks only for recalled rows.
 * Deterministic, side-effect free.
 */
export function compareRecalled(ranked: RankedClaim[]): ComparisonResult {
  const recalled = ranked.filter((row) => row.disposition === 'recalled');
  const groups = new Map<string, Claim[]>();
  for (const row of recalled) {
    // Ranked output order is fused-descending; grouping preserves
    // it, so parties read strongest-first deterministically.
    const key = [row.claim.subject, row.claim.predicate]
      .map((part) => part.trim().toLowerCase())
      .join('|');
    const group = groups.get(key) ?? [];
    group.push(row.claim);
    groups.set(key, group);
  }

  const notes: ComparisonNote[] = [];
  const proposedQuestions: ProposedQuestion[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const objects = new Set(
      group.map(
        (claim) =>
          `${claim.object.trim().toLowerCase()}|${claim.negated ? 'negated' : 'affirmed'}`,
      ),
    );
    if (objects.size <= 1) continue;
    notes.push({
      kind: 'conflict',
      subject: first.subject,
      predicate: first.predicate,
      parties: group.map(partyOf),
      relatedIds: relatedOf(group),
    });
    if (group.every((claim) => claim.status === 'active')) {
      const options = group.map(prospectiveOptionFromClaim);
      proposedQuestions.push({
        subject: first.subject,
        predicate: first.predicate,
        options,
        suggestedQuestion: suggestProspectiveQuestion(
          first.subject,
          first.predicate,
          options,
        ),
      });
    }
  }

  // Lone contradictions: recalled but no rival in the set. The
  // conflict branch above already covered paired ones.
  const paired = new Set(
    notes.flatMap((note) =>
      note.kind === 'conflict' ? note.parties.map((p) => p.claimId) : [],
    ),
  );
  for (const row of recalled) {
    if (row.claim.status !== 'contradicted' || paired.has(row.claim.id)) {
      continue;
    }
    notes.push({
      kind: 'contradicted',
      claimId: row.claim.id,
      subject: row.claim.subject,
      predicate: row.claim.predicate,
      object: row.claim.object,
      origin: row.claim.origin,
      relatedIds: [...row.claim.related],
    });
  }

  return { notes, proposedQuestions };
}
