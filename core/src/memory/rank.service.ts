import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { Claim, ClaimOrigin } from './claim';
import { ClaimRepository } from './claim.repository';
import { MemoryCandidateRepository } from './memory-candidate.repository';
import { reliabilityFactor } from './maintenance';
import type { RecallHit, RecallSurfaceName } from './recall.service';
import { SourceReliabilityRepository } from './source-reliability.repository';

/** M12d activation re-score weight (multiplicative lift, never a gate). */
export const ACTIVATION_RANK_WEIGHT = 0.2;
import {
  CONTRADICTED_DEMOTE,
  DEFAULT_FAMILIAR_LIMIT,
  DEFAULT_RECALLED_LIMIT,
  ageDaysBetween,
  recencyBoost,
  rrfFuse,
} from './ranking';
import type { ExcludeReason, RankDisposition } from './ranking';

export interface RankLens {
  /** Origins hidden from interactive recall (lens, never deletion). */
  exclude?: ClaimOrigin[];
  /** Origins multiplicatively downweighted (factor in (0, 1]). */
  downweight?: Partial<Record<ClaimOrigin, number>>;
}

export interface RankOptions {
  /**
   * Explicit-query override: surface gated claims anyway (M11d sets
   * this when the turn directly asks about a belief). Reported, not
   * silent — the gate reason stays on the row.
   */
  includeGated?: boolean;
  lens?: RankLens;
  recalledLimit?: number;
  familiarLimit?: number;
  /** Injectable clock for deterministic tests. */
  nowMs?: number;
}

export interface RankedClaim {
  claim: Claim;
  fusedScore: number;
  surfaces: RecallSurfaceName[];
  disposition: RankDisposition;
  /** Contradicted: recallable but demoted and labeled, never dropped. */
  demoted: boolean;
  /**
   * M12c source influence (null = no track record, neutral).
   * Losing records dampen the fused score; the factor rides in
   * `reasons` per the M12f trace requirement.
   */
  reliability: number | null;
  excludeReason?: ExcludeReason;
  /** Human-readable audit trail for the M11d trace. */
  reasons: string[];
}

export interface RankTrace {
  gated: string[];
  lensExcluded: string[];
  demoted: string[];
  familiar: string[];
  duplicates: string[];
  vanished: string[];
  recencyFallback: string[];
}

export interface RankResult {
  ranked: RankedClaim[];
  trace: RankTrace;
}

const emptyTrace = (): RankTrace => ({
  gated: [],
  lensExcluded: [],
  demoted: [],
  familiar: [],
  duplicates: [],
  vanished: [],
  recencyFallback: [],
});

/**
 * Ranking (M11b): relevance first, honesty constraints as gates.
 * Reads claims + ledger timestamps, mutates nothing — the only
 * M11 writer (`accessCount`/`lastAccessedAt`) stays unwritten until
 * M11d's turn path. Every exclusion lands in the trace with its
 * reason; nothing vanishes silently.
 */
@Injectable()
export class RankService {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly claims: ClaimRepository,
    private readonly candidates: MemoryCandidateRepository,
    private readonly reliability: SourceReliabilityRepository,
  ) {}

  async rank(
    hits: RecallHit[],
    options: RankOptions = {},
  ): Promise<RankResult> {
    const trace = emptyTrace();
    const nowMs = options.nowMs ?? Date.now();

    // 1. Resolve + dedupe by claim id (a claim on three surfaces is
    // one row with three witnesses, not three rows).
    const merged = new Map<string, Set<RecallSurfaceName>>();
    const bySurface = new Map<RecallSurfaceName, string[]>();
    for (const hit of hits) {
      const surfaces = merged.get(hit.claimId) ?? new Set<RecallSurfaceName>();
      surfaces.add(hit.surface);
      merged.set(hit.claimId, surfaces);
      const list = bySurface.get(hit.surface) ?? [];
      list.push(hit.claimId);
      bySurface.set(hit.surface, list);
    }

    const rows: RankedClaim[] = [];
    for (const [claimId, surfaces] of merged) {
      const claim = await this.claims.getClaim(claimId);
      if (!claim) {
        trace.vanished.push(claimId);
        continue;
      }
      const ranks = [...bySurface.entries()].flatMap(([surface, ids]) => {
        const position = ids.indexOf(claimId);
        return position >= 0 && surfaces.has(surface) ? [position + 1] : [];
      });
      const recency = await this.recencyBoostFor(claim, nowMs, trace);
      let fused = rrfFuse(ranks) * recency;
      const reasons: string[] = [
        `fused ${ranks.length} surface(s) rrf=${rrfFuse(ranks).toFixed(4)} recency=${recency.toFixed(3)}`,
      ];
      let demoted = false;
      if (claim.status === 'contradicted') {
        fused *= CONTRADICTED_DEMOTE;
        demoted = true;
        trace.demoted.push(claimId);
        reasons.push('contradicted: demoted, labeled, kept');
      }
      const downweight = options.lens?.downweight?.[claim.origin];
      if (downweight !== undefined && downweight !== 1) {
        fused *= downweight;
        reasons.push(`lens downweight ${claim.origin} x${downweight}`);
      }
      const reliability = await this.reliabilityFor(claim);
      if (reliability !== null && reliability < 1) {
        fused *= reliability;
        reasons.push(`source reliability ${reliability.toFixed(2)}`);
      }
      // M12d activation re-scores, never decides: salience bends
      // order among gated rows but admits nothing (gates run on
      // confidence regardless) and creates no hits.
      if (claim.activation !== null && claim.activation > 0) {
        const lift = 1 + ACTIVATION_RANK_WEIGHT * claim.activation;
        fused *= lift;
        reasons.push(
          `activation ${claim.activation.toFixed(2)} x${lift.toFixed(2)}`,
        );
      }
      rows.push({
        claim,
        fusedScore: fused,
        surfaces: [...surfaces],
        disposition: 'unranked',
        demoted,
        reliability,
        reasons,
      });
    }

    // 2. Gates (hard exclusions, always traced).
    const gate = this.config.memoryRecallConfidenceGate;
    for (const row of rows) {
      const id = row.claim.id;
      if (options.lens?.exclude?.includes(row.claim.origin) === true) {
        row.disposition = 'excluded';
        row.excludeReason = 'lens';
        row.reasons.push(`lens excludes origin ${row.claim.origin}`);
        trace.lensExcluded.push(id);
        continue;
      }
      if (
        row.claim.confidence < gate &&
        !row.claim.locked &&
        options.includeGated !== true
      ) {
        row.disposition = 'excluded';
        row.excludeReason = 'gate';
        row.reasons.push(
          `confidence ${row.claim.confidence.toFixed(2)} below gate ${gate}`,
        );
        trace.gated.push(id);
      } else if (row.claim.confidence < gate) {
        row.reasons.push(
          `below gate ${gate} but surfaced (${row.claim.locked ? 'locked' : 'explicit query'})`,
        );
      }
    }

    // 3. Near-duplicate suppression (same triple + marker across ids
    // cannot happen through the repository — identity forbids it —
    // but legacy/hand-built rows must never double-surface).
    const seen = new Map<string, RankedClaim>();
    for (const row of rows) {
      if (row.disposition === 'excluded') continue;
      const key = [
        row.claim.subject,
        row.claim.predicate,
        row.claim.object,
        row.claim.negated ? 'negated' : 'affirmed',
      ]
        .map((part) => part.trim().toLowerCase())
        .join('|');
      const incumbent = seen.get(key);
      if (!incumbent || row.fusedScore > incumbent.fusedScore) {
        if (incumbent) {
          incumbent.disposition = 'excluded';
          incumbent.excludeReason = 'duplicate';
          incumbent.reasons.push(`near-duplicate of ${row.claim.id}`);
          trace.duplicates.push(incumbent.claim.id);
        }
        seen.set(key, row);
      } else {
        row.disposition = 'excluded';
        row.excludeReason = 'duplicate';
        row.reasons.push(`near-duplicate of ${incumbent.claim.id}`);
        trace.duplicates.push(row.claim.id);
      }
    }

    // 4. Bands: recalled, then familiar near-misses, then unranked.
    const contenders = rows
      .filter((row) => row.disposition !== 'excluded')
      .sort((a, b) => b.fusedScore - a.fusedScore);
    const recalledLimit = options.recalledLimit ?? DEFAULT_RECALLED_LIMIT;
    const familiarLimit = options.familiarLimit ?? DEFAULT_FAMILIAR_LIMIT;
    contenders.forEach((row, index) => {
      if (index < recalledLimit) {
        row.disposition = 'recalled';
      } else if (index < recalledLimit + familiarLimit) {
        row.disposition = 'familiar';
        row.reasons.push('near-miss: adjacent, not certain');
        trace.familiar.push(row.claim.id);
      }
    });

    // Stable output order: disposition band, then fused score.
    const bandOrder: Record<RankDisposition, number> = {
      recalled: 0,
      familiar: 1,
      unranked: 2,
      excluded: 3,
    };
    rows.sort(
      (a, b) =>
        bandOrder[a.disposition] - bandOrder[b.disposition] ||
        b.fusedScore - a.fusedScore,
    );
    return { ranked: rows, trace };
  }

  /**
   * M12c source influence: resolve the first-evidence source key
   * (role/model, read-only ledger join — same pattern as recency)
   * and dampen repeatedly-losing sources. No record means neutral
   * (null, factor untouched). Punishment only: the factor caps at
   * 1, never rewards.
   */
  private async reliabilityFor(claim: Claim): Promise<number | null> {
    const first = claim.evidence[0];
    if (!first) return null;
    const candidate = await this.candidates.getCandidate(first.candidateId);
    if (!candidate) return null;
    const record = await this.reliability.get(
      `${candidate.source.role}/${candidate.extractorModel}`,
    );
    if (!record) return null;
    const factor = reliabilityFactor(record.wins, record.losses);
    return factor < 1 ? factor : null;
  }

  /**
   * Recency gradient over true evidence time: resolve the
   * `lastSurfacedAt` ledger reference to the candidate's
   * `extractedAt`. (The M11 plan names `lastSurfacedAt` directly,
   * but the field holds a reference, not a timestamp — resolving it
   * is the faithful reading.) A ledger-missed reference falls back
   * to the claim's own `updatedAt`, traced.
   */
  private async recencyBoostFor(
    claim: Claim,
    nowMs: number,
    trace: RankTrace,
  ): Promise<number> {
    const candidate = await this.candidates.getCandidate(claim.lastSurfacedAt);
    if (candidate) {
      return recencyBoost(ageDaysBetween(nowMs, candidate.extractedAt));
    }
    trace.recencyFallback.push(claim.id);
    return recencyBoost(ageDaysBetween(nowMs, claim.updatedAt));
  }
}
