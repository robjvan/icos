import type { ComparisonNote } from './comparison';
import type { KbHit } from './kb-bridge';
import type { RankedClaim } from './rank.service';

/**
 * Token estimate for budgeting: characters / 4, rounded up. A
 * documented approximation, not a tokenizer — consistent within a
 * turn, comparable across rows, and honest about what it is. M11e
 * budgets in these units end to end.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function claimLine(row: RankedClaim): string {
  const claim = row.claim;
  const object = claim.negated ? `not "${claim.object}"` : `"${claim.object}"`;
  const tags = [
    `origin ${claim.origin}`,
    `confidence ${claim.confidence.toFixed(2)}`,
    ...(row.demoted ? ['contradicted — superseded, kept for context'] : []),
  ].join(', ');
  return `- ${claim.subject} ${claim.predicate} ${object} (${tags})`;
}

function conflictLine(
  note: Extract<ComparisonNote, { kind: 'conflict' }>,
): string {
  const sides = note.parties
    .map(
      (party) =>
        `${party.negated ? 'not ' : ''}"${party.object}" (origin ${party.origin}, ${party.status})`,
    )
    .join(' vs ');
  return `[conflict] ${note.subject} ${note.predicate}: ${sides}`;
}

/**
 * Memory band (M11d): recalled beliefs as labeled lines with origin
 * + confidence on every row, contradicted rows flagged, conflicts
 * stated inline, near-misses in their own uncertain voice. Null
 * when there is nothing to say — an empty band is omitted, never
 * sent as an empty message (byte-identical context on recall miss).
 * Negated beliefs render `not "X"` (Phase 5 renders richer labels;
 * the band never shows two identical rivals).
 */
export function buildMemoryBand(
  ranked: RankedClaim[],
  notes: ComparisonNote[],
): string | null {
  const recalled = ranked.filter((row) => row.disposition === 'recalled');
  const familiar = ranked.filter((row) => row.disposition === 'familiar');
  const lines: string[] = [];
  if (recalled.length > 0) {
    lines.push(
      `[memory: ${recalled.length} recalled belief(s) from prior turns — beliefs, not user speech]`,
      ...recalled.map(claimLine),
    );
  }
  for (const note of notes) {
    if (note.kind === 'conflict') lines.push(conflictLine(note));
    else
      lines.push(
        `[contradicted] ${note.subject} ${note.predicate} "${note.object}" (origin ${note.origin}) — superseded, kept for context`,
      );
  }
  if (familiar.length > 0) {
    lines.push(
      `[vaguely familiar — uncertain, not verified]: ${familiar
        .map(
          (row) =>
            `${row.claim.subject} ${row.claim.predicate} "${row.claim.object}" (origin ${row.claim.origin}, confidence ${row.claim.confidence.toFixed(2)})`,
        )
        .join('; ')}`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * KB band (M11d): labeled corpus slot. Null unless the bridge
 * returned hits — an empty band is omitted, never sent as filler
 * (byte-identical context on recall miss, like the memory band).
 * Absence is declared in the recall trace (`kb.available`), not in
 * the prompt. M11 owns the slot; the corpus is M21's.
 */
export function buildKbBand(hits: KbHit[], available: boolean): string | null {
  if (!available || hits.length === 0) return null;
  return [
    '[knowledge-base: corpus-owned, not user speech]',
    ...hits.map((hit) => `- ${hit.snippet ?? hit.id} (score ${hit.score})`),
  ].join('\n');
}

export interface BandBudget {
  maxTokens: number;
}

export interface BudgetedBand {
  /** Trimmed rows actually rendered (notes are never trimmed). */
  ranked: RankedClaim[];
  /** Claim ids dropped for budget, lowest priority first. */
  dropped: string[];
  band: string | null;
}

/**
 * Shrink order, documented and fixed: familiar near-misses first
 * (lowest fused first), then demoted rows, then lowest-fused
 * recalled rows. Conflict/contradicted notes are never trimmed —
 * they are short and honesty-critical. The user band is outside
 * this function entirely and can never be truncated for memory.
 */
export function applyBandBudget(
  ranked: RankedClaim[],
  notes: ComparisonNote[],
  budget: BandBudget,
): BudgetedBand {
  const droppable = (row: RankedClaim): boolean =>
    row.disposition === 'familiar' ||
    row.demoted ||
    row.disposition === 'recalled';
  const priority = (row: RankedClaim): number =>
    (row.disposition === 'familiar' ? 0 : row.demoted ? 1 : 2) * 1_000_000 +
    row.fusedScore;
  let kept = [...ranked];
  const dropped: string[] = [];
  let band = buildMemoryBand(kept, notes);
  while (band !== null && estimateTokens(band) > budget.maxTokens) {
    const victim = kept
      .filter(droppable)
      .sort((a, b) => priority(a) - priority(b))[0];
    if (!victim) break;
    kept = kept.filter((row) => row.claim.id !== victim.claim.id);
    dropped.push(victim.claim.id);
    band = buildMemoryBand(kept, notes);
  }
  return { ranked: kept, dropped, band };
}
