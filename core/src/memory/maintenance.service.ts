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
  ACTIVATION_FAN_CAP,
  ACTIVATION_MIN_INTERVAL_MS,
  COMPOUND_BOOST,
  COMPOUND_CEILING,
  COMPOUND_LEVEL_CAP,
  CONFIDENCE_MAX,
  DECAY_FLOOR,
  DECAY_GRACE_DAYS,
  DECAY_HALF_LIFE_DAYS,
  DECAY_HALF_LIFE_MULTIPLIER,
  DIVERGENCE_ACTIVATION_MIN,
  DIVERGENCE_CONFIDENCE_MAX,
  EMPTY_PASS,
  GIST_FAMILY_SIZE,
  LOCK_CONFIDENCE_MIN,
  LOCK_CORROBORATION_BAR,
  MAINTENANCE_PASS_LIMIT,
  RETIRE_AFTER_DAYS,
  RETIRE_CONFIDENCE_MAX,
  SUPPRESS_STEP,
  activationBoost,
  activationDecayStep,
  spreadShare,
} from './maintenance';
import type { MaintenanceOutcome, PassSummary } from './maintenance';
import { MemoryCandidateRepository } from './memory-candidate.repository';
import { PromotionJournalRepository } from './promotion-journal.repository';
import { ProspectiveItemRepository } from './prospective-item.repository';
import {
  prospectiveOptionFromClaim,
  suggestProspectiveQuestion,
} from './prospective-item';
import { RecallTraceStore } from './recall-trace.store';
import { SourceReliabilityRepository } from './source-reliability.repository';

/** Thrown when a record fails the retirement eligibility rule. */
export class RetirementIneligibleError extends Error {
  constructor(reason: string) {
    super(`Claim ineligible for retirement: ${reason}`);
    this.name = 'RetirementIneligibleError';
  }
}

/**
 * Revision winner policy (M12c): fixed order, no model vibes.
 * Human-approved authority first (an approval outranks automatic
 * assimilation), then corroboration count, then recency (freshest
 * evidence), then id for total order. Pure and unit-pinned.
 */
export function pickRevisionWinner(rivals: Claim[]): Claim {
  const [winner] = [...rivals].sort((a, b) => {
    const authority = Number(isApproved(b)) - Number(isApproved(a));
    if (authority !== 0) return authority;
    if (b.timesObserved !== a.timesObserved) {
      return b.timesObserved - a.timesObserved;
    }
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt < a.updatedAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });
  if (!winner) throw new Error('pickRevisionWinner needs a rival');
  return winner;
}

function isApproved(claim: Claim): boolean {
  return claim.promotion.startsWith('approved:');
}

/**
 * Bounded compounding step (v2's capped compounding, no ratchet to
 * certainty): `boost × min(cap, timesObserved)`, hard-capped below
 * 1. The dampening fraction (1 for user testimony) slows machine-made
 * beliefs. Pure — the service decides *whether*, this decides *how
 * much*.
 */
export function compoundConfidence(
  confidence: number,
  timesObserved: number,
  dampening = 1,
): number {
  const step =
    COMPOUND_BOOST *
    Math.min(COMPOUND_LEVEL_CAP, Math.max(1, timesObserved)) *
    dampening;
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
    private readonly candidates: MemoryCandidateRepository,
    private readonly reliability: SourceReliabilityRepository,
    private readonly prospective: ProspectiveItemRepository,
    private readonly traces: RecallTraceStore,
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
    summary.suppressed = await this.suppressFromTraces();
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
   * Retrieval-shaped suppression (M12d, gentle default): near-miss
   * competitors from stored recall traces lose activation, not
   * confidence — recalling sharpens the target without punishing
   * neighbors' truth. Trace-driven (no M11 path changes): every
   * familiar-ranked claim in every stored trace is suppressed once
   * per trace — a newer `suppress` row than the trace means done.
   * Returns the suppressed count for the summary.
   */
  private async suppressFromTraces(): Promise<number> {
    let suppressed = 0;
    for (const trace of this.traces.listAll()) {
      for (const row of trace.ranked) {
        if (row.disposition !== 'familiar') continue;
        const claim = await this.claims.getClaim(row.claimId);
        if (!claim || claim.activation === null) continue;
        const latest = await this.history.latestByClaimAndTransition(
          claim.id,
          'suppress',
        );
        if (latest && latest.createdAt >= trace.at) continue;
        const next = Math.max(0, claim.activation - SUPPRESS_STEP);
        if (next >= claim.activation) continue;
        const updated = await this.claims.setActivation(claim.id, next);
        if (!updated) continue;
        await this.history.record({
          claimId: claim.id,
          transition: 'suppress',
          detail: { traceAt: trace.at },
          confidenceBefore: null,
          confidenceAfter: null,
        });
        suppressed += 1;
      }
    }
    return suppressed;
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
   * compound corroboration, decay neglect, link counterparts,
   * propose gist families, resolve standing rival pairs, lock or
   * unlock certainty, touch activation, stamp source type. Rungs
   * append at the end — detection (gist) precedes resolution
   * (revise), salience (activate) precedes metadata (classify),
   * and nothing outranks substance.
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
    if (await this.revise(claim)) return 'revised';
    if (await this.maintainLock(claim)) return 'locked';
    if (await this.activate(claim, nowMs)) return 'activated';
    if (await this.classify(claim)) return 'classified';
    return 'skipped';
  }

  /**
   * Compound unapplied corroboration: the latest `compound` history
   * row records the timesObserved it applied, so re-running
   * converges instead of ratcheting. Below-ceiling only; locked
   * claims compound like any other (lock guards decay, not growth).
   * Agent-origin claims compound at the dampened fraction (v2's
   * self-echo rule): machine-made beliefs must earn confidence
   * from outside corroboration, never from their own repetition.
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
    const dampened = claim.origin === 'agent';
    const before = claim.confidence;
    const after = compoundConfidence(
      before,
      claim.timesObserved,
      dampened ? this.config.memoryAgentDampening : 1,
    );
    if (after <= before) return false;
    const updated = await this.claims.adjustConfidence(claim.id, after);
    if (!updated) return false;
    await this.history.record({
      claimId: claim.id,
      transition: 'compound',
      detail: {
        timesObserved: claim.timesObserved,
        ...(dampened
          ? { dampened: true, factor: this.config.memoryAgentDampening }
          : {}),
      },
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
   * Revision (M12c): resolve standing active-active rival pairs the
   * promotion path never converged (races, negation transients,
   * legacy rows). Winner-picking policy, fixed order, no model
   * vibes: human-approved authority first, then corroboration
   * count, then recency — final tiebreak by id for total order.
   * The loser goes contradicted with history intact (M10e behavior
   * kept); both sides link and record `revise` rows, and their
   * sources accrue win/loss. One active head per triple after.
   * Comparison runs over ranked shells (comparison speaks only for
   * recalled rows — here every member is ranked); proposals are
   * ignored (no auto-parking: recall recommends, promotion parks).
   */
  private async revise(claim: Claim): Promise<boolean> {
    // Re-read: an earlier record in this same pass may have resolved
    // this claim already (revision touches rivals, not just self —
    // the pass-start snapshot goes stale by design, never by bug).
    const fresh = await this.claims.getClaim(claim.id);
    if (!fresh || fresh.status !== 'active') return false;
    const rivals = await this.activeRivals(fresh);
    if (rivals.length === 0) return false;
    const contenders = [fresh, ...rivals];
    const winner = pickRevisionWinner(contenders);
    let changed = false;
    for (const contender of contenders) {
      const won = contender.id === winner.id;
      await this.recordRevisionOutcome(contender, won);
      if (won) {
        await this.history.record({
          claimId: contender.id,
          transition: 'revise',
          detail: {
            outcome: 'affirmed',
            policy: 'authority>corroboration>recency',
          },
          confidenceBefore: contender.confidence,
          confidenceAfter: contender.confidence,
        });
        continue;
      }
      const demoted = await this.claims.setStatus(contender.id, 'contradicted');
      if (!demoted) continue;
      changed = true;
      await this.history.record({
        claimId: contender.id,
        transition: 'revise',
        detail: {
          outcome: 'superseded',
          winner: winner.id,
          policy: 'authority>corroboration>recency',
        },
        confidenceBefore: contender.confidence,
        confidenceAfter: demoted.confidence,
      });
      await this.claims.addRelated(contender.id, [winner.id]);
      await this.claims.addRelated(winner.id, [contender.id]);
    }
    return changed;
  }

  /**
   * Active rivals for revision: same normalized subject+predicate,
   * distinct objects or opposite markers, both active. Read-only
   * lookup — the transition happens in `revise`.
   */
  private async activeRivals(claim: Claim): Promise<Claim[]> {
    const rivals = await this.claims.findBySubjectPredicate(
      claim.subject,
      claim.predicate,
    );
    return rivals.filter(
      (rival) =>
        rival.id !== claim.id &&
        rival.status === 'active' &&
        (normalizeTripleField(rival.object) !==
          normalizeTripleField(claim.object) ||
          rival.negated !== claim.negated),
    );
  }

  /** Source key for reliability tracking: role/model of first evidence. */
  private async sourceKeyFor(claim: Claim): Promise<string | null> {
    const first = claim.evidence[0];
    if (!first) return null;
    const candidate = await this.candidates.getCandidate(first.candidateId);
    if (!candidate) return null;
    return `${candidate.source.role}/${candidate.extractorModel}`;
  }

  private async recordRevisionOutcome(
    claim: Claim,
    won: boolean,
  ): Promise<void> {
    const key = await this.sourceKeyFor(claim);
    if (!key) return;
    await this.reliability.recordOutcome(key, won);
  }

  /**
   * Certainty lifecycle (M12c): lock at high corroboration +
   * confidence (guards decay, never revision), unlock when evidence
   * wins anyway (a locked loser unlocks with history). Counted
   * under `locked` either way — the history rows distinguish.
   */
  private async maintainLock(claim: Claim): Promise<boolean> {
    if (claim.locked && claim.status === 'contradicted') {
      const updated = await this.claims.setLocked(claim.id, false);
      if (!updated) return false;
      await this.history.record({
        claimId: claim.id,
        transition: 'unlock',
        detail: { reason: 'contradicted' },
        confidenceBefore: claim.confidence,
        confidenceAfter: updated.confidence,
      });
      return true;
    }
    if (
      !claim.locked &&
      claim.timesObserved >= LOCK_CORROBORATION_BAR &&
      claim.confidence >= LOCK_CONFIDENCE_MIN
    ) {
      const updated = await this.claims.setLocked(claim.id, true);
      if (!updated) return false;
      await this.history.record({
        claimId: claim.id,
        transition: 'lock',
        detail: {
          timesObserved: claim.timesObserved,
          confidence: claim.confidence,
        },
        confidenceBefore: claim.confidence,
        confidenceAfter: updated.confidence,
      });
      return true;
    }
    return false;
  }

  /**
   * Activation touch (M12d): salience orthogonal to truth. A claim
   * retrieved since its last touch is boosted and spreads a
   * fan-capped share along `related[]` links (insertion-ordered
   * first N); an untouched claim with set activation decays one
   * step per interval window. Null stays null until first touch —
   * salience exists only for lived claims. Every write gets its
   * `activate` history row. Afterwards the divergence check may
   * park a review item (no claim write — the item is the audit).
   */
  private async activate(claim: Claim, nowMs: number): Promise<boolean> {
    const latest = await this.history.latestByClaimAndTransition(
      claim.id,
      'activate',
    );
    // Freshness compares access identity, not clocks: the last
    // self-boost records the access string it answered, so a repeat
    // pass with no new access converges at any timestamp
    // resolution (millisecond collisions can't ratchet).
    const touched =
      claim.lastAccessedAt !== null &&
      claim.lastAccessedAt !== (await this.lastBoostAccess(claim.id));
    let changed = false;
    if (touched && claim.lastAccessedAt !== null) {
      changed =
        (await this.applyActivation(claim, activationBoost(claim.activation), {
          spread: true,
          accessedAt: claim.lastAccessedAt,
        })) || changed;
    } else if (
      claim.activation !== null &&
      (latest === null ||
        nowMs - Date.parse(latest.createdAt) >= ACTIVATION_MIN_INTERVAL_MS)
    ) {
      const next = activationDecayStep(claim.activation);
      if (next < claim.activation) {
        changed =
          (await this.applyActivation(claim, next, { spread: false })) ||
          changed;
      }
    }
    if (!changed) return false;
    await this.checkDivergence(claim.id);
    return true;
  }

  /** Access string of the latest self-boost, if any. */
  private async lastBoostAccess(claimId: string): Promise<string | null> {
    const rows = await this.history.listByClaimId(claimId);
    let best: string | null = null;
    for (const row of rows) {
      if (row.transition !== 'activate') continue;
      const at = row.detail['accessedAt'];
      if (typeof at === 'string' && (best === null || at > best)) best = at;
    }
    return best;
  }

  private async applyActivation(
    claim: Claim,
    value: number,
    options: { spread: boolean; accessedAt?: string },
  ): Promise<boolean> {
    const updated = await this.claims.setActivation(claim.id, value);
    if (!updated) return false;
    await this.history.record({
      claimId: claim.id,
      transition: 'activate',
      detail: {
        activation: value,
        ...(options.accessedAt !== undefined
          ? { accessedAt: options.accessedAt }
          : {}),
      },
      confidenceBefore: null,
      confidenceAfter: null,
    });
    if (options.spread) {
      const neighbors = claim.related.slice(
        0,
        Math.min(claim.related.length, ACTIVATION_FAN_CAP),
      );
      const share = spreadShare(claim.related.length);
      for (const neighborId of neighbors) {
        const neighbor = await this.claims.getClaim(neighborId);
        if (!neighbor) continue;
        const boosted = Math.min(1, (neighbor.activation ?? 0) + share);
        const written = await this.claims.setActivation(neighborId, boosted);
        if (!written) continue;
        await this.history.record({
          claimId: neighborId,
          transition: 'activate',
          detail: { activation: boosted, spreadFrom: claim.id },
          confidenceBefore: null,
          confidenceAfter: null,
        });
      }
    }
    return true;
  }

  /**
   * Divergence review (M12d): persistently loud but wrong —
   * activation at/above threshold against confidence at/below
   * threshold on an active claim — parks a clarification question
   * (trigger `confidence_drop`: the confidence did drop). Skips
   * when a question is already parked for the pair. The
   * self-correction mechanism dynamics builds toward.
   */
  private async checkDivergence(claimId: string): Promise<void> {
    const claim = await this.claims.getClaim(claimId);
    if (
      !claim ||
      claim.status !== 'active' ||
      claim.activation === null ||
      claim.activation < DIVERGENCE_ACTIVATION_MIN ||
      claim.confidence > DIVERGENCE_CONFIDENCE_MAX
    ) {
      return;
    }
    const open = await this.prospective.findOpenBySubjectPredicate(
      claim.subject,
      claim.predicate,
    );
    if (open) return;
    const option = prospectiveOptionFromClaim(claim);
    await this.prospective.create({
      subject: claim.subject,
      predicate: claim.predicate,
      options: [option],
      contestCount: 1,
      trigger: 'confidence_drop',
      suggestedQuestion: suggestProspectiveQuestion(
        claim.subject,
        claim.predicate,
        [option],
      ),
    });
  }
  /**
   * Source classification (M12c): stamp the reserved `sourceType`
   * once by fixed rule — user testimony at high extractor
   * confidence is direct statement, mid is inference, low is
   * speculation; machine-made beliefs cap at inference (an agent
   * statement is never direct testimony). First stamp wins, like
   * origin; history-rowed like every mutation.
   */
  private async classify(claim: Claim): Promise<boolean> {
    if (claim.sourceType !== null) return false;
    const sourceType =
      claim.origin === 'agent'
        ? 'inference'
        : claim.extractorConfidence >= 0.8
          ? 'direct_statement'
          : claim.extractorConfidence >= 0.5
            ? 'inference'
            : 'speculation';
    const updated = await this.claims.setSourceType(claim.id, sourceType);
    if (!updated) return false;
    await this.history.record({
      claimId: claim.id,
      transition: 'classify',
      detail: {
        sourceType,
        origin: claim.origin,
        extractorConfidence: claim.extractorConfidence,
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
