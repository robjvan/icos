import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import {
  DEFAULT_MITIGATION_POSTURE,
  type HallucinationSeverity,
  type MitigationPosture,
  type MitigationStrategy,
} from './hallucination-modes';
import { HallucinationLedgerRepository } from './hallucination-ledger.repository';
import type { HallucinationMitigationEntry } from './hallucination-ledger.repository';
import type { ClaimFinding, MitigationPlan } from './hallucination.types';

const STRATEGY_RANK: Record<MitigationStrategy, number> = {
  none: 0,
  flag: 1,
  re_ground: 2,
  defer: 3,
  refuse: 4,
};

const SEVERITY_RANK: Record<HallucinationSeverity, number> = {
  info: 0,
  watch: 1,
  warning: 2,
  critical: 3,
};

/**
 * Hallucination mitigation (M15.5d).
 *
 * Turns findings into an **explicit** action — `flag`, `re_ground`,
 * `defer`, or `refuse` — according to a per-severity posture, and logs
 * every action with the finding that drove it. There is no silent
 * rewriting: the strategy is decided here, recorded in the append-only
 * ledger, and (at turn time) applied by the caller. `re_ground` means
 * retrieve and re-answer; the retrieval/LLM execution is the caller's, so
 * this layer stays pure and testable.
 *
 * The posture is configurable; the defaults are conservative — never
 * present an unresolvable or contradicted claim as settled.
 */
@Injectable()
export class HallucinationMitigationService {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly ledger: HallucinationLedgerRepository,
  ) {}

  /** The effective posture (defaults merged with any config override). */
  posture(): MitigationPosture {
    return {
      ...DEFAULT_MITIGATION_POSTURE,
      ...(this.config.hallucinationMitigationPosture ?? {}),
    };
  }

  /** The strictest strategy across findings, per the posture. */
  plan(findings: readonly ClaimFinding[]): MitigationPlan {
    if (findings.length === 0) {
      return { strategy: 'none', trigger: null, reasons: ['no findings'] };
    }
    const posture = this.posture();
    let best: { strategy: MitigationStrategy; finding: ClaimFinding } | null =
      null;
    for (const finding of findings) {
      const candidate = posture[finding.severity];
      if (
        best === null ||
        STRATEGY_RANK[candidate] > STRATEGY_RANK[best.strategy] ||
        (STRATEGY_RANK[candidate] === STRATEGY_RANK[best.strategy] &&
          SEVERITY_RANK[finding.severity] >
            SEVERITY_RANK[best.finding.severity])
      ) {
        best = { strategy: candidate, finding };
      }
    }
    if (best === null) {
      return { strategy: 'none', trigger: null, reasons: ['no findings'] };
    }
    return {
      strategy: best.strategy,
      trigger: best.finding,
      reasons: [
        `strictest posture for "${best.finding.severity}" is "${best.strategy}"`,
        best.finding.reason,
      ],
    };
  }

  /**
   * Record a plan in the ledger. A `none` strategy is not a mitigation and
   * is not logged. Returns the ledger entry, or null.
   */
  async record(
    plan: MitigationPlan,
    context?: { subject?: string; detail?: Record<string, unknown> },
  ): Promise<HallucinationMitigationEntry | null> {
    if (plan.strategy === 'none') {
      return null;
    }
    const trigger = plan.trigger;
    return this.ledger.record({
      severity: trigger?.severity ?? 'info',
      strategy: plan.strategy,
      mode: trigger?.mode ?? null,
      reason: plan.reasons.join(' '),
      subject: context?.subject ?? null,
      ...(context?.detail !== undefined ? { detail: context.detail } : {}),
    });
  }
}
