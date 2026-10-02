/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { PersonaDatabaseService } from './persona-database.service';
import { PersonaRepository } from './persona.repository';
import type {
  CreatePersonaRecordInput,
  LogPersonaDriftInput,
  PersonaCandidate,
  PersonaCandidateCategory,
  PersonaCandidateStatus,
  PersonaCategory,
  PersonaDriftEntry,
  PersonaDriftSeverity,
  PersonaProposedTarget,
  PersonaRecord,
  PersonaRelationship,
  PersonaSensitivity,
  PersonaUserFact,
  StagePersonaCandidateInput,
  UpsertPersonaRelationshipInput,
  UpsertPersonaUserFactInput,
} from './persona.types';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const DEFAULT_CONFIDENCE = 0.85;
const DEFAULT_CANDIDATE_CONFIDENCE = 0.65;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Deterministic id from content. Deterministic (not random) so staging
 * and repeated seed imports are idempotent: the same observation always
 * maps to the same row instead of duplicating.
 */
function createId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');
  return `${prefix}-${digest.slice(0, 24)}`;
}

function stringify(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    return null;
  }
  const text = `${value as string | number | boolean}`;
  return text.length > 0 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface PersonaRecordRow {
  record_id: string;
  user_id: string;
  category: string;
  content: string;
  confidence: number;
  sensitivity: string;
  is_protected: number;
  source: string;
  source_turn_id: string | null;
  claim_id: string | null;
  metadata_json: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PersonaUserFactRow {
  memory_id: string;
  user_id: string;
  content: string;
  confidence: number;
  source: string;
  source_turn_id: string | null;
  claim_id: string | null;
  metadata_json: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PersonaRelationshipRow {
  state_id: string;
  user_id: string;
  trust_level: number;
  emotional_temperature: number;
  active_nicknames_json: string;
  recent_developments_json: string;
  last_significant_interaction: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface PersonaCandidateRow {
  candidate_id: string;
  user_id: string;
  observation: string;
  category: string;
  confidence: number;
  session_id: string | null;
  source: string;
  source_turn_id: string | null;
  claim_id: string | null;
  proposed_target: string | null;
  status: string;
  review_outcome: string | null;
  review_reason: string | null;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  metadata_json: string | null;
}

interface PersonaDriftRow {
  log_id: string;
  user_id: string;
  subject_id: string;
  severity: string;
  change_type: string;
  previous_value: string | null;
  new_value: string | null;
  reason: string;
  reviewed: number;
  reviewed_at: string | null;
  metadata_json: string | null;
  created_at: string;
}

function mapRecord(row: PersonaRecordRow): PersonaRecord {
  return {
    recordId: row.record_id,
    userId: row.user_id,
    category: row.category as PersonaCategory,
    content: row.content,
    confidence: row.confidence,
    sensitivity: row.sensitivity as PersonaSensitivity,
    protected: row.is_protected === 1,
    source: row.source,
    sourceTurnId: nullableString(row.source_turn_id),
    claimId: nullableString(row.claim_id),
    metadata: parseJsonObject(row.metadata_json),
    reviewedBy: nullableString(row.reviewed_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserFact(row: PersonaUserFactRow): PersonaUserFact {
  return {
    memoryId: row.memory_id,
    userId: row.user_id,
    content: row.content,
    confidence: row.confidence,
    source: row.source,
    sourceTurnId: nullableString(row.source_turn_id),
    claimId: nullableString(row.claim_id),
    metadata: parseJsonObject(row.metadata_json),
    reviewedBy: nullableString(row.reviewed_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationship(row: PersonaRelationshipRow): PersonaRelationship {
  return {
    stateId: row.state_id,
    userId: row.user_id,
    trustLevel: row.trust_level,
    emotionalTemperature: row.emotional_temperature,
    activeNicknames: parseJsonArray(row.active_nicknames_json),
    recentDevelopments: parseJsonArray(row.recent_developments_json),
    lastSignificantInteraction: row.last_significant_interaction,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCandidate(row: PersonaCandidateRow): PersonaCandidate {
  return {
    candidateId: row.candidate_id,
    userId: row.user_id,
    observation: row.observation,
    category: row.category as PersonaCandidateCategory,
    confidence: row.confidence,
    sessionId: nullableString(row.session_id),
    source: row.source,
    sourceTurnId: nullableString(row.source_turn_id),
    claimId: nullableString(row.claim_id),
    proposedTarget: nullableString(
      row.proposed_target,
    ) as PersonaProposedTarget | null,
    status: row.status as PersonaCandidateStatus,
    reviewOutcome: nullableString(row.review_outcome),
    reviewReason: nullableString(row.review_reason),
    reviewedBy: nullableString(row.reviewed_by),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    reviewedAt: nullableString(row.reviewed_at),
  };
}

function mapDrift(row: PersonaDriftRow): PersonaDriftEntry {
  return {
    logId: row.log_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    severity: row.severity as PersonaDriftSeverity,
    changeType: row.change_type,
    previousValue: nullableString(row.previous_value),
    newValue: nullableString(row.new_value),
    reason: row.reason,
    reviewed: row.reviewed === 1,
    reviewedAt: nullableString(row.reviewed_at),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

@Injectable()
export class SqlitePersonaRepository extends PersonaRepository {
  constructor(private readonly databaseService: PersonaDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async createRecord(input: CreatePersonaRecordInput): Promise<PersonaRecord> {
    const now = input.occurredAt ?? nowIso();
    const recordId =
      input.recordId ??
      createId(
        'persona-record',
        `${input.userId}:${input.category}:${input.content}`,
      );
    const existing = this.getRecordRow(recordId);

    if (
      existing?.is_protected === 1 &&
      existing.content !== input.content &&
      !input.reviewedBy?.trim()
    ) {
      throw new Error(
        `Persona record ${recordId} is protected; overwriting it requires a reviewer.`,
      );
    }

    const confidence =
      input.confidence ?? existing?.confidence ?? DEFAULT_CONFIDENCE;
    const sensitivity =
      input.sensitivity ??
      (existing?.sensitivity as PersonaSensitivity | undefined) ??
      'normal';
    const existingProtected = existing?.is_protected === 1;
    const isProtected = (input.protected ?? existingProtected) ? 1 : 0;
    const metadata = input.metadata ?? parseJsonObject(existing?.metadata_json);
    const createdAt = existing?.created_at ?? now;

    this.database
      .prepare(
        `INSERT INTO persona_records (
           record_id, user_id, category, content, confidence, sensitivity,
           is_protected, source, source_turn_id, claim_id, metadata_json,
           reviewed_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_id) DO UPDATE SET
           category = excluded.category,
           content = excluded.content,
           confidence = excluded.confidence,
           sensitivity = excluded.sensitivity,
           is_protected = excluded.is_protected,
           source = excluded.source,
           source_turn_id = excluded.source_turn_id,
           claim_id = excluded.claim_id,
           metadata_json = excluded.metadata_json,
           reviewed_by = excluded.reviewed_by,
           updated_at = excluded.updated_at`,
      )
      .run(
        recordId,
        input.userId,
        input.category,
        input.content,
        confidence,
        sensitivity,
        isProtected,
        input.source,
        input.sourceTurnId ?? existing?.source_turn_id ?? null,
        input.claimId ?? existing?.claim_id ?? null,
        stringify(metadata),
        input.reviewedBy ?? existing?.reviewed_by ?? null,
        createdAt,
        now,
      );

    return this.requireRecord(recordId);
  }

  async getRecord(recordId: string): Promise<PersonaRecord | null> {
    const row = this.getRecordRow(recordId);
    return row ? mapRecord(row) : null;
  }

  async listRecords(
    userId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<PersonaRecord[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM persona_records
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(userId, this.capLimit(limit)) as PersonaRecordRow[];
    return rows.map(mapRecord);
  }

  async upsertUserFact(
    input: UpsertPersonaUserFactInput,
  ): Promise<PersonaUserFact> {
    const now = input.occurredAt ?? nowIso();
    const memoryId =
      input.memoryId ??
      createId('persona-user', `${input.userId}:${input.content}`);

    this.database
      .prepare(
        `INSERT INTO persona_user_model (
           memory_id, user_id, content, confidence, source, source_turn_id,
           claim_id, metadata_json, reviewed_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
           content = excluded.content,
           confidence = excluded.confidence,
           source = excluded.source,
           source_turn_id = excluded.source_turn_id,
           claim_id = excluded.claim_id,
           metadata_json = excluded.metadata_json,
           reviewed_by = excluded.reviewed_by,
           updated_at = excluded.updated_at`,
      )
      .run(
        memoryId,
        input.userId,
        input.content,
        input.confidence ?? DEFAULT_CONFIDENCE,
        input.source,
        input.sourceTurnId ?? null,
        input.claimId ?? null,
        stringify(input.metadata),
        input.reviewedBy ?? null,
        now,
        now,
      );

    const row = this.getUserFactRow(memoryId);
    if (!row) throw new Error(`User fact ${memoryId} vanished after upsert`);
    return mapUserFact(row);
  }

  async getUserFact(memoryId: string): Promise<PersonaUserFact | null> {
    const row = this.getUserFactRow(memoryId);
    return row ? mapUserFact(row) : null;
  }

  async listUserFacts(
    userId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<PersonaUserFact[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM persona_user_model
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(userId, this.capLimit(limit)) as PersonaUserFactRow[];
    return rows.map(mapUserFact);
  }

  async upsertRelationship(
    input: UpsertPersonaRelationshipInput,
  ): Promise<PersonaRelationship> {
    const now = input.occurredAt ?? nowIso();
    const stateId = createId('persona-rel', input.userId);
    const existing = this.getRelationshipRow(input.userId);
    const current = existing ? mapRelationship(existing) : null;

    this.database
      .prepare(
        `INSERT INTO persona_relationship (
           state_id, user_id, trust_level, emotional_temperature,
           active_nicknames_json, recent_developments_json,
           last_significant_interaction, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           trust_level = excluded.trust_level,
           emotional_temperature = excluded.emotional_temperature,
           active_nicknames_json = excluded.active_nicknames_json,
           recent_developments_json = excluded.recent_developments_json,
           last_significant_interaction = excluded.last_significant_interaction,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        stateId,
        input.userId,
        clamp(input.trustLevel, 0, 1),
        clamp(input.emotionalTemperature, -1, 1),
        stringify(input.activeNicknames ?? current?.activeNicknames ?? []),
        stringify(
          input.recentDevelopments ?? current?.recentDevelopments ?? [],
        ),
        input.lastSignificantInteraction ??
          current?.lastSignificantInteraction ??
          now,
        stringify(input.metadata ?? current?.metadata),
        existing?.created_at ?? now,
        now,
      );

    const row = this.getRelationshipRow(input.userId);
    if (!row) throw new Error('Relationship state vanished after upsert');
    return mapRelationship(row);
  }

  async getRelationship(userId: string): Promise<PersonaRelationship | null> {
    const row = this.getRelationshipRow(userId);
    return row ? mapRelationship(row) : null;
  }

  async stageCandidate(
    input: StagePersonaCandidateInput,
  ): Promise<PersonaCandidate> {
    const now = input.occurredAt ?? nowIso();
    const candidateId =
      input.candidateId ??
      createId('persona-candidate', `${input.userId}:${input.observation}`);
    const existing = this.getCandidateRow(candidateId);

    this.database
      .prepare(
        `INSERT INTO persona_candidates (
           candidate_id, user_id, observation, category, confidence,
           session_id, source, source_turn_id, claim_id, proposed_target,
           status, created_at, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           observation = excluded.observation,
           category = excluded.category,
           confidence = excluded.confidence,
           session_id = excluded.session_id,
           source = excluded.source,
           source_turn_id = excluded.source_turn_id,
           claim_id = excluded.claim_id,
           proposed_target = excluded.proposed_target,
           metadata_json = excluded.metadata_json`,
      )
      .run(
        candidateId,
        input.userId,
        input.observation,
        input.category,
        input.confidence ??
          existing?.confidence ??
          DEFAULT_CANDIDATE_CONFIDENCE,
        input.sessionId ?? existing?.session_id ?? null,
        input.source ?? existing?.source ?? 'persona',
        input.sourceTurnId ?? existing?.source_turn_id ?? null,
        input.claimId ?? existing?.claim_id ?? null,
        input.proposedTarget ?? existing?.proposed_target ?? null,
        now,
        stringify(input.metadata ?? parseJsonObject(existing?.metadata_json)),
      );

    const row = this.getCandidateRow(candidateId);
    if (!row) throw new Error(`Candidate ${candidateId} vanished after stage`);
    return mapCandidate(row);
  }

  async getCandidate(candidateId: string): Promise<PersonaCandidate | null> {
    const row = this.getCandidateRow(candidateId);
    return row ? mapCandidate(row) : null;
  }

  async listPendingCandidates(
    userId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<PersonaCandidate[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM persona_candidates
         WHERE user_id = ? AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(userId, this.capLimit(limit)) as PersonaCandidateRow[];
    return rows.map(mapCandidate);
  }

  async logDrift(input: LogPersonaDriftInput): Promise<PersonaDriftEntry> {
    const now = input.occurredAt ?? nowIso();
    const logId =
      input.logId ??
      createId(
        'persona-drift',
        `${input.userId}:${input.subjectId}:${input.changeType}:${now}`,
      );

    this.database
      .prepare(
        `INSERT INTO persona_drift_log (
           log_id, user_id, subject_id, severity, change_type, previous_value,
           new_value, reason, reviewed, reviewed_at, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(log_id) DO NOTHING`,
      )
      .run(
        logId,
        input.userId,
        input.subjectId,
        input.severity,
        input.changeType,
        input.previousValue ?? null,
        input.newValue ?? null,
        input.reason,
        input.reviewed ? 1 : 0,
        input.reviewedAt ?? null,
        stringify(input.metadata),
        now,
      );

    const row = this.getDriftRow(logId);
    if (!row) throw new Error(`Drift entry ${logId} vanished after log`);
    return mapDrift(row);
  }

  async listRecentDrift(
    userId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<PersonaDriftEntry[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM persona_drift_log
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(userId, this.capLimit(limit)) as PersonaDriftRow[];
    return rows.map(mapDrift);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }

  private getRecordRow(recordId: string): PersonaRecordRow | undefined {
    return this.database
      .prepare('SELECT * FROM persona_records WHERE record_id = ?')
      .get(recordId) as PersonaRecordRow | undefined;
  }

  private requireRecord(recordId: string): PersonaRecord {
    const row = this.getRecordRow(recordId);
    if (!row) throw new Error(`Persona record ${recordId} vanished`);
    return mapRecord(row);
  }

  private getUserFactRow(memoryId: string): PersonaUserFactRow | undefined {
    return this.database
      .prepare('SELECT * FROM persona_user_model WHERE memory_id = ?')
      .get(memoryId) as PersonaUserFactRow | undefined;
  }

  private getRelationshipRow(
    userId: string,
  ): PersonaRelationshipRow | undefined {
    return this.database
      .prepare('SELECT * FROM persona_relationship WHERE user_id = ?')
      .get(userId) as PersonaRelationshipRow | undefined;
  }

  private getCandidateRow(
    candidateId: string,
  ): PersonaCandidateRow | undefined {
    return this.database
      .prepare('SELECT * FROM persona_candidates WHERE candidate_id = ?')
      .get(candidateId) as PersonaCandidateRow | undefined;
  }

  private getDriftRow(logId: string): PersonaDriftRow | undefined {
    return this.database
      .prepare('SELECT * FROM persona_drift_log WHERE log_id = ?')
      .get(logId) as PersonaDriftRow | undefined;
  }

  private capLimit(limit: number): number {
    return Math.min(Math.max(Math.trunc(limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
  }
}
