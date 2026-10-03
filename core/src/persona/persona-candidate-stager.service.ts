import { Injectable, Logger } from '@nestjs/common';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { PersonaDriftService } from './persona-drift.service';
import { PersonaRepository } from './persona.repository';
import {
  DEFAULT_PERSONA_USER_ID,
  type PersonaCandidateCategory,
  type PersonaProposedTarget,
} from './persona.types';

/**
 * Memory subjects that name the agent itself. A fact about the agent is
 * identity-relevant; a fact about anything else is not. Conservative and
 * extendable — a false positive only sits in the review queue.
 */
const AGENT_SUBJECT_ALIASES = new Set([
  'agent',
  'assistant',
  'icos',
  'isabel',
  'self',
  'the agent',
  'the assistant',
]);

interface CandidateTarget {
  category: PersonaCandidateCategory;
  proposedTarget: PersonaProposedTarget;
}

/**
 * Persona candidate staging (M14e): the adapter between memory extraction
 * and the persona review queue.
 *
 * **Stage only.** It reads memory candidates and writes `persona_candidates`
 * rows — never a `persona_records` row, never the core. Promotion out of
 * the queue is review (M14f). Idempotent by the deterministic candidate id
 * over the rendered triple, so re-observing the same claim does not
 * duplicate, and a candidate that has already been reviewed is not
 * resurrected to pending.
 *
 * This is the mechanical "memory extracts, persona adjudicates" boundary:
 * the classifier here is deliberately narrow, and every staged row carries
 * its memory provenance for the reviewer.
 */
@Injectable()
export class PersonaCandidateStager {
  private readonly logger = new Logger(PersonaCandidateStager.name);

  constructor(
    private readonly repository: PersonaRepository,
    private readonly drift: PersonaDriftService,
  ) {}

  /** Stage identity-relevant observations. Returns how many were staged. */
  async stageFromMemoryCandidates(
    candidates: readonly MemoryCandidate[],
  ): Promise<number> {
    let staged = 0;
    for (const candidate of candidates) {
      const target = classify(candidate);
      if (!target) {
        continue;
      }
      const stagedCandidate = await this.repository.stageCandidate({
        userId: DEFAULT_PERSONA_USER_ID,
        observation: renderObservation(candidate),
        category: target.category,
        confidence: candidate.confidence,
        sessionId: candidate.source.sessionId,
        source: 'memory-extraction',
        sourceTurnId: String(candidate.source.messageId),
        proposedTarget: target.proposedTarget,
        metadata: {
          memoryCandidateId: candidate.id,
          kind: candidate.kind,
          subject: candidate.subject,
          predicate: candidate.predicate,
          object: candidate.object,
          negated: candidate.negated,
          sourceRole: candidate.source.role,
          extractorModel: candidate.extractorModel,
        },
        occurredAt: candidate.extractedAt,
      });
      // M15b: structural drift is checked the moment a candidate is
      // staged. Observes only; fail-soft — a drift error never blocks
      // staging.
      try {
        await this.drift.evaluateCandidate(stagedCandidate);
      } catch (error) {
        this.logger.warn(
          `Drift evaluation failed for ${stagedCandidate.candidateId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
      staged += 1;
    }
    if (staged > 0) {
      this.logger.log(`Staged ${staged} persona candidate(s) for review.`);
    }
    return staged;
  }
}

function classify(candidate: MemoryCandidate): CandidateTarget | null {
  switch (candidate.kind) {
    case 'preference':
      return { category: 'preference', proposedTarget: 'persona_user_model' };
    case 'relationship':
      return {
        category: 'relationship',
        proposedTarget: 'persona_relationship',
      };
    case 'fact':
    case 'observation':
    case 'goal':
    case 'decision':
      return isAgentSubject(candidate.subject)
        ? { category: 'identity', proposedTarget: 'persona_record' }
        : null;
    default:
      return null;
  }
}

function isAgentSubject(subject: string): boolean {
  return AGENT_SUBJECT_ALIASES.has(subject.trim().toLowerCase());
}

function renderObservation(candidate: MemoryCandidate): string {
  const object = candidate.negated
    ? `not ${candidate.object}`
    : candidate.object;
  return `${candidate.subject} ${candidate.predicate} ${object}`.replace(
    /\s+/g,
    ' ',
  );
}
