import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { Claim } from './claim';
import { ClaimHistoryRepository } from './claim-history.repository';
import { ClaimRepository } from './claim.repository';
import { normalizeTripleField } from './claim-identity';
import {
  COMPOUND_BOOST,
  COMPOUND_CEILING,
  COMPOUND_LEVEL_CAP,
  CONFIDENCE_MAX,
  EMPTY_PASS,
  GIST_FAMILY_SIZE,
  MAINTENANCE_PASS_LIMIT,
} from './maintenance';
import type { MaintenanceOutcome, PassSummary } from './maintenance';
import { PromotionJournalRepository } from './promotion-journal.repository';

/**
 * Bounded compounding step (v2's capped compounding, no ratchet to
 * certainty): `boost × min(cap, timesObserved)`, hard-capped below
 * 1. Pure — the service decides *whether*, this decides *how much*.
 */
export function compoundConfidence(
  confidence: number,
  timesObserved: number,
): number {
  const step =
    COMPOUND_BOOST * Math.min(COMPOUND_LEVEL_CAP, Math.max(1, timesObserved));
  return Math.min(CONFIDENCE_MAX, COMPOUND_CEILING, confidence + step);
}

/**
 * Background maintenance (M12a): reinforcement compounding,
 * contradiction cross-links, gist-family detection. Async and
 * boring by design — per-record isolation (one record, one
 * transition, one history row), a failed record never aborts the
 * pass, and nothing here blocks a turn. Scheduling is a plain
 * interval (cadence + kill-switch in config); the explicit
 * `POST /core/maintenance/run` path drives tests, manual runs,
 * and recovery.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly claims: ClaimRepository,
    private readonly history: ClaimHistoryRepository,
    private readonly journal: PromotionJournalRepository,
  ) {}

  onModuleInit(): void {
    if (!this.config.memoryMaintenanceEnabled) return;
    const intervalMs = this.config.memoryMaintenanceIntervalMs;
    this.timer = setInterval(() => {
      void this.runPass().catch((err: unknown) => {
        this.logger.warn(
          `Scheduled maintenance pass failed: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      });
    }, intervalMs);
    // A live timer must never hold the process open in tests.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Explicit pass: manual trigger, test driver, recovery path. */
  async runPass(): Promise<PassSummary> {
    const started = Date.now();
    const summary: PassSummary = { ...EMPTY_PASS };
    const claims = await this.claims.listClaims({
      limit: MAINTENANCE_PASS_LIMIT,
    });
    const families = this.episodeFamilies(claims);
    for (const claim of claims) {
      try {
        const outcome = await this.maintainOne(claim, families);
        // Outcome names follow history-transition spelling; the
        // summary uses camelCase — mapped explicitly (no clever
        // indexing: a mismatch here silently drops counts).
        if (outcome === 'gist_proposed') summary.gistProposed += 1;
        else summary[outcome] += 1;
      } catch (err) {
        this.logger.warn(
          `Maintenance failed on claim ${claim.id}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
        summary.failed += 1;
      }
    }
    summary.durationMs = Date.now() - started;
    return summary;
  }

  /**
   * Exactly one transition per record per pass, fixed priority:
   * compound new corroboration first (belief strengthened),
   * then link unlinked contradiction counterparts (traversal
   * substrate), then gist-propose unreviewed families. Anything
   * else skips — later slices (decay, revision) add their rungs
   * to this ladder without reordering it.
   */
  private async maintainOne(
    claim: Claim,
    families: Map<string, Claim[]>,
  ): Promise<MaintenanceOutcome> {
    if (await this.compound(claim)) return 'compounded';
    if (await this.linkCounterparts(claim)) return 'linked';
    if (await this.proposeGist(claim, families)) return 'gist_proposed';
    return 'skipped';
  }

  /**
   * Compound unapplied corroboration: the latest `compound` history
   * row records the timesObserved it applied, so re-running
   * converges instead of ratcheting. Below-ceiling only; locked
   * claims compound like any other (lock guards decay, not growth).
   */
  private async compound(claim: Claim): Promise<boolean> {
    if (claim.timesObserved <= 1) return false;
    if (claim.confidence >= COMPOUND_CEILING) return false;
    const latest = await this.history.latestByClaimAndTransition(
      claim.id,
      'compound',
    );
    const applied = latest?.detail['timesObserved'];
    if (typeof applied === 'number' && applied >= claim.timesObserved) {
      return false;
    }
    const before = claim.confidence;
    const after = compoundConfidence(before, claim.timesObserved);
    if (after <= before) return false;
    const updated = await this.claims.adjustConfidence(claim.id, after);
    if (!updated) return false;
    await this.history.record({
      claimId: claim.id,
      transition: 'compound',
      detail: { timesObserved: claim.timesObserved },
      confidenceBefore: before,
      confidenceAfter: after,
    });
    return true;
  }

  /**
   * Link contradiction counterparts both ways from committed
   * journal rows (`contradicts:<id>` — the same source the
   * web-client reads). Idempotent: linked pairs skip. This is the
   * traversal substrate M11 was promised — populated here, read
   * there, never walked here.
   */
  private async linkCounterparts(claim: Claim): Promise<boolean> {
    const rows = await this.journal.listByState(['committed']);
    const counterparts = new Set<string>();
    for (const row of rows) {
      if (row.operation !== 'CONTRADICT') continue;
      const match = /(?:^|[\s;])contradicts:([^\s;]+)/.exec(row.detail);
      const loserId = match?.[1];
      if (!loserId || !row.claimId) continue;
      if (row.claimId === claim.id) counterparts.add(loserId);
      if (loserId === claim.id) counterparts.add(row.claimId);
    }
    const unlinked = [...counterparts].filter(
      (id) => !claim.related.includes(id),
    );
    if (unlinked.length === 0) return false;
    const updated = await this.claims.addRelated(claim.id, unlinked);
    if (!updated) return false;
    await this.history.record({
      claimId: claim.id,
      transition: 'link',
      detail: { related: unlinked },
      confidenceBefore: null,
      confidenceAfter: null,
    });
    return true;
  }

  /**
   * Gist-family detection (proposal only): N≥3 distinct claims
   * sharing normalized subject+predicate with distinct evidence are
   * episodes possibly worth generalizing. Each family proposes once
   * — the proposal is a `gist_proposed` history row on every member
   * (sibling ids + suggested shape), reviewable through claim
   * history. Generalization itself goes through M10 promotion
   * authority when designed; M12a writes no beliefs, only the
   * observation that a family exists.
   */
  private async proposeGist(
    claim: Claim,
    families: Map<string, Claim[]>,
  ): Promise<boolean> {
    const key = [claim.subject, claim.predicate]
      .map((part) => normalizeTripleField(part))
      .join('|');
    const family = families.get(key) ?? [];
    if (family.length < GIST_FAMILY_SIZE) return false;
    const latest = await this.history.latestByClaimAndTransition(
      claim.id,
      'gist_proposed',
    );
    const seen = latest?.detail['family'];
    const siblings = family
      .map((member) => member.id)
      .filter((id) => id !== claim.id)
      .sort();
    if (
      Array.isArray(seen) &&
      seen.length === siblings.length &&
      seen.every((id, index) => id === siblings[index])
    ) {
      return false;
    }
    await this.history.record({
      claimId: claim.id,
      transition: 'gist_proposed',
      detail: {
        family: siblings,
        suggestion: `${claim.subject} ${claim.predicate} *`,
      },
      confidenceBefore: null,
      confidenceAfter: null,
    });
    return true;
  }

  /**
   * Episode families: normalized subject+predicate groups with
   * pairwise-distinct evidence sets. Shared evidence means shared
   * derivation, not independent episodes — those groups never
   * propose.
   */
  private episodeFamilies(claims: Claim[]): Map<string, Claim[]> {
    const groups = new Map<string, Claim[]>();
    for (const claim of claims) {
      const key = [claim.subject, claim.predicate]
        .map((part) => normalizeTripleField(part))
        .join('|');
      const group = groups.get(key) ?? [];
      group.push(claim);
      groups.set(key, group);
    }
    const families = new Map<string, Claim[]>();
    for (const [key, group] of groups) {
      if (group.length < GIST_FAMILY_SIZE) continue;
      const evidenceSets = group.map(
        (claim) => new Set(claim.evidence.map((item) => item.candidateId)),
      );
      const distinct = evidenceSets.every(
        (set, index) =>
          evidenceSets.findIndex(
            (other) =>
              other.size === set.size && [...other].every((id) => set.has(id)),
          ) === index,
      );
      if (distinct) families.set(key, group);
    }
    return families;
  }
}
