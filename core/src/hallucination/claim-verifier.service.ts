import { Injectable } from '@nestjs/common';
import { ClaimConsistencyService } from './claim-consistency.service';
import {
  HALLUCINATION_DEFAULTS,
  HALLUCINATION_SEVERITY,
} from './hallucination-modes';
import { LlmVerifier } from './llm-verifier.service';
import { SystemoneVerifier } from './systemone-verifier.service';
import { unavailable } from './verification.support';
import type {
  ClaimAssertion,
  ClaimFinding,
  ClaimVerificationResult,
  VerificationBackend,
  VerificationVerdict,
} from './hallucination.types';

/**
 * Tiered claim verification (M15.5c).
 *
 * Composition of the deterministic classifier with a secondary model.
 * Backend tiers, preferred first:
 *
 * 1. **decision** — a systemone decision model (local Jev-style, or a
 *    Jev-compatible server);
 * 2. **llm** — an OpenAI-compatible chat model (e.g. the local gemma4) in a
 *    verifier role;
 * 3. **none** — deterministic checks only.
 *
 * Only high-stakes assertions are verified. A verifier never
 * auto-resolves: its verdict is recorded, and disagreement with the
 * deterministic classification is surfaced as a flag, not a rewrite. With
 * no verifier, a high-stakes assertion the evidence cannot resolve is
 * flagged `unverifiable_high_stakes` rather than smuggled through.
 */
@Injectable()
export class ClaimVerifierService {
  constructor(
    private readonly consistency: ClaimConsistencyService,
    private readonly decision: SystemoneVerifier,
    private readonly llm: LlmVerifier,
  ) {}

  /** The tier that would run right now, or null. */
  activeBackend(): VerificationBackend | null {
    if (this.decision.isConfigured()) return 'decision';
    if (this.llm.isConfigured()) return 'llm';
    return null;
  }

  async verify(
    assertion: ClaimAssertion,
    speakerModel?: string,
  ): Promise<ClaimVerificationResult> {
    const deterministic = await this.consistency.classify(assertion);
    const findings: ClaimFinding[] = [...deterministic.findings];
    const highStakes =
      (assertion.confidence ?? 0) >=
      HALLUCINATION_DEFAULTS.highStakesConfidenceFloor;

    if (!highStakes) {
      return {
        ...deterministic,
        verification: unavailable(null, 'not high-stakes; deterministic only'),
        disagreement: false,
        findings,
      };
    }

    const request = {
      assertion,
      evidenceSummary: deterministic.reasons.join(' '),
      ...(speakerModel !== undefined ? { speakerModel } : {}),
    };
    let verification: VerificationVerdict;
    if (this.decision.isConfigured()) {
      verification = await this.decision.verify(request);
    } else if (this.llm.isConfigured()) {
      verification = await this.llm.verify(request);
    } else {
      verification = unavailable(null, 'no verifier configured');
    }

    let disagreement = false;
    if (!verification.available) {
      if (deterministic.classification !== 'supported') {
        findings.push({
          mode: 'unverifiable_high_stakes',
          severity: HALLUCINATION_SEVERITY.unverifiable_high_stakes,
          reason:
            'High-stakes assertion could not be resolved by evidence, and no verifier was available.',
        });
      }
    } else if (verification.verdict !== 'unknown') {
      disagreement = verification.verdict !== deterministic.classification;
    }

    return { ...deterministic, verification, disagreement, findings };
  }
}
