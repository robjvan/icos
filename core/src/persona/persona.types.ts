/**
 * M14 persona model.
 *
 * The curated self-model, deliberately isolated from the memory ledger:
 * memory may *stage* a candidate here, but only review writes a record,
 * and the immutable core (a read-only file, M14b) is not represented by
 * any type in this file.
 *
 * These types describe the **evolving** tier and the staging/audit
 * records around it. `confidence`, `sensitivity`, and `protected`
 * mirror the v2 Coherence Engine's provenance discipline; `protected`
 * means "explicit review is required to overwrite", not "immutable".
 */

/** Category of an evolved identity/self record. */
export type PersonaCategory =
  | 'self'
  | 'value'
  | 'belief'
  | 'boundary'
  | 'commitment'
  | 'agentic_character'
  | 'relationship'
  | 'other';

export type PersonaSensitivity = 'normal' | 'sensitive' | 'protected';

/** Category of an identity-relevant observation awaiting review. */
export type PersonaCandidateCategory =
  | 'identity'
  | 'nickname'
  | 'value'
  | 'belief'
  | 'preference'
  | 'boundary'
  | 'trust'
  | 'relationship';

/** Which evolving store a candidate is proposed to land in. */
export type PersonaProposedTarget =
  'persona_record' | 'persona_user_model' | 'persona_relationship';

export type PersonaCandidateStatus = 'pending' | 'reviewed';

/**
 * Drift severity. `cumulative` sits above `critical` and is reserved for
 * persistent direction change across review cycles (M15d).
 */
export type PersonaDriftSeverity =
  'info' | 'watch' | 'warning' | 'critical' | 'cumulative';

/** Default user scope. Single-user today; a seam for later multi-user. */
export const DEFAULT_PERSONA_USER_ID = 'user';

export interface PersonaRecord {
  recordId: string;
  userId: string;
  category: PersonaCategory;
  content: string;
  confidence: number;
  sensitivity: PersonaSensitivity;
  protected: boolean;
  source: string;
  sourceTurnId: string | null;
  claimId: string | null;
  metadata?: Record<string, unknown>;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaUserFact {
  memoryId: string;
  userId: string;
  content: string;
  confidence: number;
  source: string;
  sourceTurnId: string | null;
  claimId: string | null;
  metadata?: Record<string, unknown>;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaRelationship {
  stateId: string;
  userId: string;
  trustLevel: number;
  emotionalTemperature: number;
  activeNicknames: string[];
  recentDevelopments: string[];
  lastSignificantInteraction: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaCandidate {
  candidateId: string;
  userId: string;
  observation: string;
  category: PersonaCandidateCategory;
  confidence: number;
  sessionId: string | null;
  source: string;
  sourceTurnId: string | null;
  claimId: string | null;
  proposedTarget: PersonaProposedTarget | null;
  status: PersonaCandidateStatus;
  reviewOutcome: string | null;
  reviewReason: string | null;
  reviewedBy: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
}

export interface PersonaDriftEntry {
  logId: string;
  userId: string;
  subjectId: string;
  severity: PersonaDriftSeverity;
  changeType: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string;
  reviewed: boolean;
  reviewedAt: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreatePersonaRecordInput {
  /** Explicit id to update in place; otherwise derived from content. */
  recordId?: string;
  userId: string;
  category: PersonaCategory;
  content: string;
  confidence?: number;
  sensitivity?: PersonaSensitivity;
  protected?: boolean;
  source: string;
  sourceTurnId?: string | null;
  claimId?: string | null;
  reviewedBy?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface UpsertPersonaUserFactInput {
  memoryId?: string;
  userId: string;
  content: string;
  confidence?: number;
  source: string;
  sourceTurnId?: string | null;
  claimId?: string | null;
  reviewedBy?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface UpsertPersonaRelationshipInput {
  userId: string;
  trustLevel: number;
  emotionalTemperature: number;
  activeNicknames?: string[];
  recentDevelopments?: string[];
  lastSignificantInteraction?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface StagePersonaCandidateInput {
  candidateId?: string;
  userId: string;
  observation: string;
  category: PersonaCandidateCategory;
  confidence?: number;
  sessionId?: string | null;
  source?: string;
  sourceTurnId?: string | null;
  claimId?: string | null;
  proposedTarget?: PersonaProposedTarget | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface LogPersonaDriftInput {
  logId?: string;
  userId: string;
  subjectId: string;
  severity: PersonaDriftSeverity;
  changeType: string;
  previousValue?: string | null;
  newValue?: string | null;
  reason: string;
  reviewed?: boolean;
  reviewedAt?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}
