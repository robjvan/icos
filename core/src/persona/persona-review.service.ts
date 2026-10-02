import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { statementsContradict } from './persona-contradiction';
import { PersonaCoreService } from './persona-core.service';
import { PersonaRepository } from './persona.repository';
import {
  DEFAULT_PERSONA_USER_ID,
  type PersonaCandidate,
  type PersonaCandidateCategory,
  type PersonaCategory,
  type PersonaDriftSeverity,
  type PersonaReviewInput,
  type PersonaReviewOutcome,
  type PersonaReviewResult,
} from './persona.types';

interface AppliedOutcome {
  target?: 'persona_record' | 'persona_user_model' | 'persona_relationship';
  targetId?: string;
  previousValue?: string;
  newValue?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persona review and curation (M14f).
 *
 * A staged candidate is applied to the evolving tier only by an explicit,
 * recorded review. Two invariants hold:
 *
 * - **Core refusal.** No approval outcome may apply content that
 *   contradicts an immutable core entry. The conflict is surfaced and
 *   logged `critical`; the candidate is not applied.
 * - **Corrigibility.** Every review requires a reason and writes an
 *   append-only drift-log entry. Revision is recorded, never punished —
 *   being corrected is not identity failure.
 *
 * Protected evolving records still require an explicit review to
 * overwrite (the store enforces the reviewer); the previous value is
 * retained on the record and in the drift log. This service is never
 * exposed as an agent tool.
 */
@Injectable()
export class PersonaReviewService {
  private readonly logger = new Logger(PersonaReviewService.name);

  constructor(
    private readonly repository: PersonaRepository,
    private readonly core: PersonaCoreService,
  ) {}

  /** Pending candidates awaiting review, newest first. */
  async listPending(): Promise<PersonaCandidate[]> {
    return this.repository.listPendingCandidates(DEFAULT_PERSONA_USER_ID);
  }

  async review(
    candidateId: string,
    input: PersonaReviewInput,
  ): Promise<PersonaReviewResult> {
    const candidate = await this.repository.getCandidate(candidateId);
    if (!candidate) {
      throw new NotFoundException(`Unknown persona candidate: ${candidateId}`);
    }
    const reviewedBy = input.reviewedBy?.trim();
    const reason = input.reason?.trim();
    if (!reviewedBy || !reason) {
      throw new BadRequestException(
        'reviewedBy and reason are required to review a candidate.',
      );
    }
    if (candidate.status === 'reviewed') {
      throw new ConflictException('Candidate has already been reviewed.');
    }

    const occurredAt = new Date().toISOString();
    const isApproval = input.outcome.startsWith('approve');

    if (isApproval) {
      const conflict = this.coreConflict(candidate.observation);
      if (conflict) {
        const drift = await this.repository.logDrift({
          userId: candidate.userId,
          subjectId: candidate.candidateId,
          severity: 'critical',
          changeType: 'core_contradiction',
          newValue: candidate.observation,
          reason: `${input.outcome} refused: candidate contradicts immutable core entry ${conflict.entryId}. ${reason}`,
          reviewed: true,
          reviewedAt: occurredAt,
          occurredAt,
          metadata: {
            candidateId,
            coreEntryId: conflict.entryId,
            attemptedOutcome: input.outcome,
          },
        });
        await this.repository.updateCandidateReview({
          candidateId,
          outcome: input.outcome,
          reviewedBy,
          reason,
          occurredAt,
          metadata: { conflictsWithCore: true, coreEntryId: conflict.entryId },
        });
        return {
          candidateId,
          outcome: input.outcome,
          applied: false,
          refused: true,
          refusalReason: 'candidate contradicts the immutable core persona',
          conflictWithCoreEntryId: conflict.entryId,
          driftLogId: drift.logId,
        };
      }
    }

    const applied = await this.apply(candidate, input, occurredAt);
    await this.repository.updateCandidateReview({
      candidateId,
      outcome: input.outcome,
      reviewedBy,
      reason,
      occurredAt,
      metadata: applied.metadata,
    });
    const drift = await this.repository.logDrift({
      userId: candidate.userId,
      subjectId: applied.targetId ?? candidate.candidateId,
      severity: severityFor(input.outcome),
      changeType: input.outcome,
      previousValue: applied.previousValue ?? null,
      newValue: applied.newValue ?? candidate.observation,
      reason,
      reviewed: true,
      reviewedAt: occurredAt,
      occurredAt,
      metadata: { candidateId, target: applied.target ?? null },
    });

    this.logger.log(
      `Reviewed persona candidate ${candidateId}: ${input.outcome} (${applied.target ?? 'no store change'})`,
    );
    return {
      candidateId,
      outcome: input.outcome,
      applied: applied.target !== undefined,
      refused: false,
      target: applied.target,
      targetId: applied.targetId,
      driftLogId: drift.logId,
    };
  }

  private coreConflict(observation: string) {
    for (const entry of this.core.getEntries()) {
      if (statementsContradict(entry.content, observation)) {
        return entry;
      }
    }
    return null;
  }

  private async apply(
    candidate: PersonaCandidate,
    input: PersonaReviewInput,
    occurredAt: string,
  ): Promise<AppliedOutcome> {
    switch (input.outcome) {
      case 'approve_to_identity':
        return this.applyIdentity(candidate, input, occurredAt);
      case 'approve_to_user_model':
        return this.applyUserModel(candidate, input, occurredAt);
      case 'approve_to_relationship':
        return this.applyRelationship(candidate, input, occurredAt);
      default:
        // reject / archive_as_transient / needs_more_evidence: recorded,
        // no store change.
        return {};
    }
  }

  private async applyIdentity(
    candidate: PersonaCandidate,
    input: PersonaReviewInput,
    occurredAt: string,
  ): Promise<AppliedOutcome> {
    const targetRecordId = metadataString(candidate.metadata, 'targetRecordId');
    const existing = targetRecordId
      ? await this.repository.getRecord(targetRecordId)
      : null;
    const record = await this.repository.createRecord({
      recordId: targetRecordId,
      userId: candidate.userId,
      category: toPersonaCategory(candidate.category),
      content: candidate.observation,
      confidence: candidate.confidence,
      protected: existing?.protected ?? false,
      sensitivity: existing?.sensitivity,
      source: 'persona-review',
      reviewedBy: input.reviewedBy,
      metadata: {
        ...(existing?.metadata ?? {}),
        candidateId: candidate.candidateId,
        reviewReason: input.reason,
        previousContent: existing?.content,
      },
      occurredAt,
    });
    return {
      target: 'persona_record',
      targetId: record.recordId,
      previousValue: existing?.content,
      newValue: candidate.observation,
    };
  }

  private async applyUserModel(
    candidate: PersonaCandidate,
    input: PersonaReviewInput,
    occurredAt: string,
  ): Promise<AppliedOutcome> {
    const targetMemoryId = metadataString(candidate.metadata, 'targetMemoryId');
    const existing = targetMemoryId
      ? await this.repository.getUserFact(targetMemoryId)
      : null;
    const fact = await this.repository.upsertUserFact({
      memoryId: targetMemoryId,
      userId: candidate.userId,
      content: candidate.observation,
      confidence: candidate.confidence,
      source: 'persona-review',
      reviewedBy: input.reviewedBy,
      metadata: {
        ...(existing?.metadata ?? {}),
        candidateId: candidate.candidateId,
        reviewReason: input.reason,
        previousContent: existing?.content,
      },
      occurredAt,
    });
    return {
      target: 'persona_user_model',
      targetId: fact.memoryId,
      previousValue: existing?.content,
      newValue: candidate.observation,
    };
  }

  private async applyRelationship(
    candidate: PersonaCandidate,
    input: PersonaReviewInput,
    occurredAt: string,
  ): Promise<AppliedOutcome> {
    const current = await this.repository.getRelationship(candidate.userId);
    const developments = [
      candidate.observation,
      ...(current?.recentDevelopments ?? []),
    ].slice(0, 10);
    const state = await this.repository.upsertRelationship({
      userId: candidate.userId,
      trustLevel: current?.trustLevel ?? 0.5,
      emotionalTemperature: current?.emotionalTemperature ?? 0,
      activeNicknames: current?.activeNicknames ?? [],
      recentDevelopments: developments,
      lastSignificantInteraction: occurredAt,
      metadata: {
        ...(current?.metadata ?? {}),
        candidateId: candidate.candidateId,
        reviewReason: input.reason,
      },
      occurredAt,
    });
    return {
      target: 'persona_relationship',
      targetId: state.stateId,
      newValue: candidate.observation,
    };
  }
}

function toPersonaCategory(
  category: PersonaCandidateCategory,
): PersonaCategory {
  switch (category) {
    case 'value':
      return 'value';
    case 'belief':
      return 'belief';
    case 'boundary':
      return 'boundary';
    case 'relationship':
    case 'trust':
      return 'relationship';
    default:
      return 'self';
  }
}

function severityFor(outcome: PersonaReviewOutcome): PersonaDriftSeverity {
  return outcome === 'reject' || outcome === 'needs_more_evidence'
    ? 'watch'
    : 'info';
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
