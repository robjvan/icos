import { Injectable } from '@nestjs/common';
import { ClaimRepository } from '../memory/claim.repository';
import type { Claim } from '../memory/claim';
import type { Triple } from '../memory/claim-identity';
import {
  HALLUCINATION_DEFAULTS,
  HALLUCINATION_SEVERITY,
} from './hallucination-modes';
import type {
  ClaimAssertion,
  ClaimConsistencyResult,
  ClaimFinding,
} from './hallucination.types';

/**
 * Deterministic claim/evidence consistency (M15.5b).
 *
 * Given an assertion the model emitted, decide whether the epistemic store
 * **supports**, **contradicts**, or neither (**novel**) — no model judgment
 * required. Evidence is the arbiter (M10 provenance):
 *
 * - **supported** — an active claim matches the assertion's triple and
 *   polarity at or above the support floor.
 * - **contradicted** — an active claim holds the opposite polarity,
 *   outweighing any support.
 * - **novel** — nothing matches; new, not contradicted. **Novelty is not
 *   failure** — it is flagged, never refused.
 *
 * It also catches **fabricated provenance**: a cited claim id that does not
 * exist. This layer detects; it does not decide what to do about a finding
 * (mitigation is M15.5d).
 */
@Injectable()
export class ClaimConsistencyService {
  constructor(private readonly claims: ClaimRepository) {}

  async classify(assertion: ClaimAssertion): Promise<ClaimConsistencyResult> {
    const triple: Triple = {
      subject: assertion.subject,
      predicate: assertion.predicate,
      object: assertion.object,
    };
    const negated = assertion.negated ?? false;
    const confidence = assertion.confidence ?? 0;
    const { supportConfidenceFloor, highStakesConfidenceFloor } =
      HALLUCINATION_DEFAULTS;

    const supporting = await this.claims.findByTriple({ ...triple, negated });
    const rival = await this.claims.findByTriple({
      ...triple,
      negated: !negated,
    });

    const active = (claim: Claim | null): claim is Claim =>
      claim !== null &&
      claim.status === 'active' &&
      claim.confidence >= supportConfidenceFloor;

    const supportingActive = active(supporting);
    const rivalActive = active(rival);

    const reasons: string[] = [];
    let classification: ClaimConsistencyResult['classification'];
    let supportingClaimId: string | undefined;
    let contradictingClaimId: string | undefined;

    if (
      rivalActive &&
      (!supportingActive ||
        (rival?.confidence ?? 0) >= (supporting?.confidence ?? 0))
    ) {
      classification = 'contradicted';
      contradictingClaimId = rival?.id;
      reasons.push(
        `The store holds the opposing claim (${negated ? 'affirmed' : 'negated'}) at confidence ${(rival?.confidence ?? 0).toFixed(2)}.`,
      );
    } else if (supportingActive) {
      classification = 'supported';
      supportingClaimId = supporting?.id;
      reasons.push(
        `Backed by an active claim at confidence ${(supporting?.confidence ?? 0).toFixed(2)} with ${supporting?.evidence.length ?? 0} evidence item(s).`,
      );
    } else {
      classification = 'novel';
      reasons.push(
        'No active claim matches this assertion; it is new, not contradicted.',
      );
    }

    const fabricatedClaimIds: string[] = [];
    for (const citedId of assertion.citedClaimIds ?? []) {
      if ((await this.claims.getClaim(citedId)) === null) {
        fabricatedClaimIds.push(citedId);
      }
    }

    const findings: ClaimFinding[] = [];
    if (fabricatedClaimIds.length > 0) {
      findings.push({
        mode: 'fabricated_provenance',
        severity: HALLUCINATION_SEVERITY.fabricated_provenance,
        reason: `Cites ${fabricatedClaimIds.length} evidence id(s) that do not exist.`,
      });
    } else if (classification === 'contradicted') {
      findings.push({
        mode: 'contradicted_claim',
        severity: HALLUCINATION_SEVERITY.contradicted_claim,
        reason: reasons[0] ?? 'Contradicted by the store.',
      });
    } else if (classification === 'novel') {
      findings.push({
        mode: 'unsupported_claim',
        severity: HALLUCINATION_SEVERITY.unsupported_claim,
        reason: 'Unsupported (novel) — flagged, not refused.',
      });
      if (confidence >= highStakesConfidenceFloor) {
        findings.push({
          mode: 'overconfident_uncertainty',
          severity: HALLUCINATION_SEVERITY.overconfident_uncertainty,
          reason: `Asserted at confidence ${confidence.toFixed(2)} on no supporting evidence.`,
        });
      }
    }

    return {
      classification,
      supportingClaimId,
      contradictingClaimId,
      fabricatedClaimIds,
      findings,
      reasons,
    };
  }
}
