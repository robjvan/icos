import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { PersonaCoreService } from './persona-core.service';
import {
  PERSONA_DRIFT_DEFAULTS,
  PERSONA_DRIFT_SEVERITY,
  type PersonaFailureMode,
} from './persona-drift';
import { statementsContradict } from './persona-contradiction';
import { PersonaGroundingService } from './persona-grounding.service';
import { PersonaRepository } from './persona.repository';
import { tokenOverlap } from './persona-similarity';
import {
  DEFAULT_PERSONA_USER_ID,
  type PersonaCandidate,
  type PersonaDriftEntry,
} from './persona.types';

/**
 * Structural drift detection (M15b).
 *
 * Observes only: it writes `persona_drift_log` and reads everything else.
 * It never edits a record, applies a candidate, or releases a finding on
 * its own. Severity comes from the M15a catalogue, never from the
 * detector. Findings are de-duplicated per unresolved `(subject,
 * change_type)` and resolved when the condition clears — reconcile, don't
 * accumulate.
 *
 * Semantic and cumulative drift are M15c/M15d; the core is a hard gate in
 * `evaluateCandidate` and is never the subject of a trend.
 */
@Injectable()
export class PersonaDriftService {
  private readonly logger = new Logger(PersonaDriftService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly repository: PersonaRepository,
    private readonly core: PersonaCoreService,
    private readonly grounding: PersonaGroundingService,
  ) {}

  /**
   * Evaluate a freshly staged candidate against the current self-model:
   * core contradiction, protected/identity contradiction, and repeated
   * pressure. Fail-soft callers should catch; this can reject on store
   * errors.
   */
  async evaluateCandidate(
    candidate: PersonaCandidate,
  ): Promise<PersonaDriftEntry[]> {
    const findings: PersonaDriftEntry[] = [];
    const subject = `candidate:${candidate.candidateId}`;

    for (const entry of this.core.getEntries()) {
      if (!statementsContradict(entry.content, candidate.observation)) {
        continue;
      }
      const finding = await this.logOnce(
        candidate.userId,
        subject,
        'core_contradiction',
        candidate.observation,
        `Candidate contradicts immutable core entry ${entry.entryId}.`,
        { candidateId: candidate.candidateId, coreEntryId: entry.entryId },
      );
      if (finding) {
        findings.push(finding);
      }
    }

    const targetRecordId = metadataString(candidate.metadata, 'targetRecordId');
    const records = await this.repository.listRecords(candidate.userId, 200);
    for (const record of records) {
      if (record.content === candidate.observation) {
        continue;
      }
      const contradicts =
        targetRecordId === record.recordId ||
        statementsContradict(record.content, candidate.observation);
      if (!contradicts) {
        continue;
      }
      const mode: PersonaFailureMode = record.protected
        ? 'protected_contradiction'
        : 'identity_contradiction';
      const finding = await this.logOnce(
        candidate.userId,
        `record:${record.recordId}`,
        mode,
        candidate.observation,
        `${record.protected ? 'Protected' : 'Identity'} record contradicted by a candidate.`,
        { candidateId: candidate.candidateId, recordId: record.recordId },
      );
      if (finding) {
        findings.push(finding);
      }
    }

    const pressure = await this.evaluatePressure(candidate);
    if (pressure) {
      findings.push(pressure);
    }
    return findings;
  }

  /**
   * Audit relationship freshness and grounding score, reconciling findings
   * whose conditions no longer hold. Returns newly raised findings.
   */
  async auditGrounding(
    userId: string = DEFAULT_PERSONA_USER_ID,
  ): Promise<PersonaDriftEntry[]> {
    const findings: PersonaDriftEntry[] = [];
    const result = await this.grounding.evaluate(userId);
    const subject = `grounding:${userId}`;

    if (result.relationshipStateAgeHours >= 0 && !result.relationshipCurrent) {
      const finding = await this.logOnce(
        userId,
        subject,
        'relationship_state_stale',
        String(result.relationshipStateAgeHours),
        'Relationship state exceeded the freshness window.',
        { ageHours: result.relationshipStateAgeHours },
      );
      if (finding) {
        findings.push(finding);
      }
    } else {
      await this.repository.resolveDrift(
        userId,
        subject,
        'relationship_state_stale',
      );
    }

    const threshold =
      this.config.personaGroundingWarmupThreshold ??
      PERSONA_DRIFT_DEFAULTS.groundingWarmupThreshold;
    if (result.overallScore < threshold) {
      const finding = await this.logOnce(
        userId,
        subject,
        'grounding_score_low',
        String(result.overallScore),
        result.details.join(' ') ||
          'Grounding score below the warm-up threshold.',
        { score: result.overallScore, threshold },
      );
      if (finding) {
        findings.push(finding);
      }
    } else {
      await this.repository.resolveDrift(
        userId,
        subject,
        'grounding_score_low',
      );
    }

    await this.reconcilePressure(userId);
    return findings;
  }

  private async evaluatePressure(
    candidate: PersonaCandidate,
  ): Promise<PersonaDriftEntry | null> {
    const threshold =
      this.config.personaCandidatePressureCount ??
      PERSONA_DRIFT_DEFAULTS.candidatePressureCount;
    const similarity =
      this.config.personaCandidatePressureSimilarity ??
      PERSONA_DRIFT_DEFAULTS.candidatePressureSimilarity;

    const pending = await this.repository.listPendingCandidates(
      candidate.userId,
      200,
    );
    const group = pending.filter(
      (item) => item.category === candidate.category,
    );
    const cluster = maxSimilarGroup(group, similarity);
    if (cluster < threshold) {
      return null;
    }
    return this.logOnce(
      candidate.userId,
      `pressure:${candidate.category}`,
      'repeated_candidate_pressure',
      candidate.observation,
      `${cluster} similar unreviewed ${candidate.category} candidates are pending.`,
      { category: candidate.category, count: cluster },
    );
  }

  /** Clear pressure findings whose cluster has dropped below threshold. */
  private async reconcilePressure(
    userId: string = DEFAULT_PERSONA_USER_ID,
  ): Promise<void> {
    const threshold =
      this.config.personaCandidatePressureCount ??
      PERSONA_DRIFT_DEFAULTS.candidatePressureCount;
    const similarity =
      this.config.personaCandidatePressureSimilarity ??
      PERSONA_DRIFT_DEFAULTS.candidatePressureSimilarity;

    const open = (await this.repository.listRecentDrift(userId, 200)).filter(
      (entry) =>
        !entry.reviewed && entry.changeType === 'repeated_candidate_pressure',
    );
    if (open.length === 0) {
      return;
    }
    const pending = await this.repository.listPendingCandidates(userId, 200);
    for (const entry of open) {
      const category = metadataString(entry.metadata, 'category') ?? '';
      const group = pending.filter((item) => item.category === category);
      if (maxSimilarGroup(group, similarity) < threshold) {
        await this.repository.resolveDrift(
          userId,
          entry.subjectId,
          'repeated_candidate_pressure',
        );
      }
    }
  }

  private async logOnce(
    userId: string,
    subjectId: string,
    mode: PersonaFailureMode,
    newValue: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<PersonaDriftEntry | null> {
    if (await this.repository.hasUnresolvedDrift(userId, subjectId, mode)) {
      return null;
    }
    const entry = await this.repository.logDrift({
      userId,
      subjectId,
      severity: PERSONA_DRIFT_SEVERITY[mode],
      changeType: mode,
      newValue,
      reason,
      metadata,
    });
    this.logger.log(
      `Drift ${mode} (${PERSONA_DRIFT_SEVERITY[mode]}) on ${subjectId}`,
    );
    return entry;
  }
}

/** Largest cluster of mutually-similar observations (>= 1 when non-empty). */
function maxSimilarGroup(
  candidates: readonly PersonaCandidate[],
  similarity: number,
): number {
  if (candidates.length === 0) {
    return 0;
  }
  let max = 1;
  for (const candidate of candidates) {
    let neighbours = 0;
    for (const other of candidates) {
      if (other === candidate) {
        continue;
      }
      if (
        tokenOverlap(candidate.observation, other.observation) >= similarity
      ) {
        neighbours += 1;
      }
    }
    max = Math.max(max, neighbours + 1);
  }
  return max;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
