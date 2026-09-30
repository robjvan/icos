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
  ACCESS_SHIELD_DAYS,
  COMPOUND_BOOST,
  COMPOUND_CEILING,
  COMPOUND_LEVEL_CAP,
  CONFIDENCE_MAX,
  DECAY_FLOOR,
  DECAY_GRACE_DAYS,
  DECAY_HALF_LIFE_DAYS,
  DECAY_HALF_LIFE_MULTIPLIER,
  EMPTY_PASS,
  GIST_FAMILY_SIZE,
  MAINTENANCE_PASS_LIMIT,
  RETIRE_AFTER_DAYS,
  RETIRE_CONFIDENCE_MAX,
} from './maintenance';
import type { MaintenanceOutcome, PassSummary } from './maintenance';
import { PromotionJournalRepository } from './promotion-journal.repository';

/** Thrown when a record fails the retirement eligibility rule. */
export class RetirementIneligibleError extends Error {
  constructor(reason: string) {
    super(`Claim ineligible for retirement: ${reason}`);
    this.name = 'RetirementIneligibleError';
  }
}

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

type DecayInput = Pick<
  Claim,
  'confidence' | 'category' | 'locked' | 'lastAccessedAt' | 'updatedAt'
>;

/**
 * Passive decay step (M12b): exponential half-life past the grace
 * period, floored per category. Returns the new confidence, or null
 * when no decay applies (locked, shielded by recent access, inside
 * grace, already at/below floor — decay never raises). Pure.
 *
 * Memoryless and idempotent: each pass applies only the increment
 * since the last decay row (`lastDecayIso`), so re-running at the
 * same instant converges instead of ratcheting. The grace period
 * and shield read the neglect reference (last access, else last
 * touch); the compounding factor reads the decay clock.
 */
export function decayStep(
  input: DecayInput,
  nowMs: number,
  lastDecayIso: string | null,
): number | null {
  if (input.locked) return null;
  const touched = Date.parse(input.lastAccessedAt ?? input.updatedAt);
  if (Number.isNaN(touched)) return null;
  if (input.lastAccessedAt) {
    const sinceAccess = Math.max(
      0,
      (nowMs - Date.parse(input.lastAccessedAt)) / 86_400_000,
    );
    // Anti-decay shield: recent access protects; never strengthens.
    if (!Number.isNaN(sinceAccess) && sinceAccess <= ACCESS_SHIELD_DAYS) {
      return null;
    }
  }
  const base = lastDecayIso ? Date.parse(lastDecayIso) : touched;
  if (Number.isNaN(base)) return null;
  const elapsedDays = Math.max(0, (nowMs - base) / 86_400_000);
  // The grace period is a one-time neglect allowance: the first
  // decay bills elapsed-minus-grace, later ones bill in full.
  const billable = Math.max(
    0,
    elapsedDays - (lastDecayIso ? 0 : DECAY_GRACE_DAYS),
  );
  if (billable <= 0) return null;
  const halfLife =
    DECAY_HALF_LIFE_DAYS * (DECAY_HALF_LIFE_MULTIPLIER[input.category] ?? 1);
  const floor = DECAY_FLOOR[input.category] ?? 0.2;
  const next = Math.max(
    floor,
    input.confidence * Math.pow(0.5, billable / halfLife),
  );
  return next < input.confidence ? next : null;
}

export interface RetireEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * Deliberate-retirement eligibility (M12b): unretrieved over the
 * long window (reads count; birth counts when never read) AND at
 * or below the confidence max. Pure — the endpoint enforces.
 */
export function retireEligibility(
  input: Pick<Claim, 'confidence' | 'lastAccessedAt' | 'createdAt'>,
  nowMs: number,
): RetireEligibility {
  const reference = Date.parse(input.lastAccessedAt ?? input.createdAt);
  if (Number.isNaN(reference)) {
    return { eligible: false, reason: 'unknown age' };
  }
  const ageDays = Math.max(0, (nowMs - reference) / 86_400_000);
  if (ageDays < RETIRE_AFTER_DAYS) {
    return {
      eligible: false,
      reason: `retrieved ${Math.floor(ageDays)}d ago (< ${RETIRE_AFTER_DAYS}d window)`,
    };
  }
  if (input.confidence > RETIRE_CONFIDENCE_MAX) {
    return {
      eligible: false,
      reason: `confidence ${input.confidence} above retire max ${RETIRE_CONFIDENCE_MAX}`,
    };
  }
  return {
    eligible: true,
    reason: 'unretrieved window + below confidence max',
  };
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
  async runPass(nowMs: number = Date.now()): Promise<PassSummary> {
    const started = Date.now();
    const summary: PassSummary = { ...EMPTY_PASS };
    const claims = await this.claims.listClaims({
      limit: MAINTENANCE_PASS_LIMIT,
    });
    const families = this.episodeFamilies(claims);
    for (const claim of claims) {
      try {
        const outcome = await this.maintainOne(claim, families, nowMs);
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
   * Deliberate retirement (M12b): explicit status transition with
   * history — the `retired` writer. Missing rows return null;
   * ineligible rows throw (the caller maps to 400); forced rows
   * bypass eligibility (explicit "forget this", HITL authority is
   * the caller). Re-retiring is a no-op without history noise.
   */
  async retireClaim(
    id: string,
    options: { force?: boolean; nowMs?: number } = {},
  ): Promise<Claim | null> {
    const claim = await this.claims.getClaim(id);
    if (!claim) return null;
    if (claim.status === 'retired') return claim;
    if (options.force !== true) {
      const { eligible, reason } = retireEligibility(
        claim,
        options.nowMs ?? Date.now(),
      );
      if (!eligible) throw new RetirementIneligibleError(reason);
    }
    const retired = await this.claims.setStatus(id, 'retired');
    if (!retired) return null;
    await this.history.record({
      claimId: id,
      transition: 'retire',
      detail: { force: options.force === true },
      confidenceBefore: claim.confidence,
      confidenceAfter: retired.confidence,
    });
    return retired;
  }

  /**
   * Exactly one transition per record per pass, fixed priority:
   * compound new corroboration, then decay neglect, then link
   * unlinked counterparts, then gist-propose unreviewed families.
   * Later slices add rungs without reordering.
   */
  private async maintainOne(
    claim: Claim,
    families: Map<string, Claim[]>,
    nowMs: number,
  ): Promise<MaintenanceOutcome> {
    if (await this.compound(claim)) return 'compounded';
    if (await this.decay(claim, nowMs)) return 'decayed';
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

  private async decay(claim: Claim, nowMs: number): Promise<boolean> {
    const latest = await this.history.latestByClaimAndTransition(
      claim.id,
      'decay',
    );
    const next = decayStep(claim, nowMs, latest?.createdAt ?? null);
    if (next === null) return false;
    const updated = await this.claims.adjustConfidence(claim.id, next);
    if (!updated) return false;
    await this.history.record({
      claimId: claim.id,
      transition: 'decay',
      detail: { category: claim.category },
      confidenceBefore: claim.confidence,
      confidenceAfter: next,
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
