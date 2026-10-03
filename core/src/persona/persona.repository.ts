import type {
  CreatePersonaRecordInput,
  LogPersonaDriftInput,
  PersonaCandidate,
  PersonaCoreState,
  PersonaDriftEntry,
  PersonaDriftTrend,
  PersonaRecord,
  PersonaRelationship,
  PersonaUserFact,
  RecordPersonaDriftTrendInput,
  StagePersonaCandidateInput,
  UpdatePersonaCandidateReviewInput,
  UpsertPersonaRelationshipInput,
  UpsertPersonaUserFactInput,
} from './persona.types';

/**
 * Persona store contract (M14a). Isolated from the memory repositories:
 * nothing here writes to the memory ledger, and nothing in memory can
 * write here except by staging a candidate.
 *
 * All methods are async by contract (the surrounding services await
 * them); the SQLite implementation is synchronous underneath.
 */
export abstract class PersonaRepository {
  /** Insert a persona record, or update one in place by explicit id. */
  abstract createRecord(
    input: CreatePersonaRecordInput,
  ): Promise<PersonaRecord>;

  abstract getRecord(recordId: string): Promise<PersonaRecord | null>;

  abstract listRecords(
    userId: string,
    limit?: number,
  ): Promise<PersonaRecord[]>;

  abstract upsertUserFact(
    input: UpsertPersonaUserFactInput,
  ): Promise<PersonaUserFact>;

  abstract getUserFact(memoryId: string): Promise<PersonaUserFact | null>;

  abstract listUserFacts(
    userId: string,
    limit?: number,
  ): Promise<PersonaUserFact[]>;

  /** Singleton relationship state per user (upsert), not a transcript. */
  abstract upsertRelationship(
    input: UpsertPersonaRelationshipInput,
  ): Promise<PersonaRelationship>;

  abstract getRelationship(userId: string): Promise<PersonaRelationship | null>;

  /** Stage an observation for review. Never applies it to a record. */
  abstract stageCandidate(
    input: StagePersonaCandidateInput,
  ): Promise<PersonaCandidate>;

  abstract getCandidate(candidateId: string): Promise<PersonaCandidate | null>;

  abstract listPendingCandidates(
    userId: string,
    limit?: number,
  ): Promise<PersonaCandidate[]>;

  /** Record a review outcome on a staged candidate (M14f). */
  abstract updateCandidateReview(
    input: UpdatePersonaCandidateReviewInput,
  ): Promise<PersonaCandidate>;

  /** Append-only drift/audit entry. Never rewritten by the store. */
  abstract logDrift(input: LogPersonaDriftInput): Promise<PersonaDriftEntry>;

  abstract listRecentDrift(
    userId: string,
    limit?: number,
  ): Promise<PersonaDriftEntry[]>;

  /** True when an unresolved finding exists for `(subject, change_type)`. */
  abstract hasUnresolvedDrift(
    userId: string,
    subjectId: string,
    changeType: string,
  ): Promise<boolean>;

  /** Mark unresolved findings for `(subject, change_type)` reviewed. */
  abstract resolveDrift(
    userId: string,
    subjectId: string,
    changeType: string,
  ): Promise<number>;

  /** Append a semantic-trend row for a record (review cycle auto-numbered). */
  abstract recordDriftTrend(
    input: RecordPersonaDriftTrendInput,
  ): Promise<PersonaDriftTrend>;

  abstract listDriftTrends(
    recordId: string,
    limit?: number,
  ): Promise<PersonaDriftTrend[]>;

  /**
   * Last recorded core-persona load (path, hash, status), for change
   * detection across boots. The core *entries* are never stored.
   */
  abstract getCoreState(): Promise<PersonaCoreState | null>;

  abstract saveCoreState(state: PersonaCoreState): Promise<void>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
