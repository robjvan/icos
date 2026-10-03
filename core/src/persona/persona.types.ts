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

/** The five immutable-core categories. */
export type PersonaCoreCategory =
  | 'ethical_grounding'
  | 'core_belief'
  | 'safety_boundary'
  | 'non_negotiable'
  | 'agentic_character';

/**
 * A parsed immutable-core entry. Never stored, never mutated, never
 * reviewable — the core is a read-only file (M14b). `immutable` is a
 * literal `true` so the type itself forbids a mutable variant.
 */
export interface PersonaCoreEntry {
  entryId: string;
  category: PersonaCoreCategory;
  content: string;
  immutable: true;
}

/** Read-only status of the core persona, for grounding and the UI. */
export interface PersonaCoreStatus {
  loaded: boolean;
  path: string;
  hash: string | null;
  entryCount: number;
  /** When this status was last evaluated (load attempt time). */
  evaluatedAt: string;
  reason?: string;
  changedSinceLastLoad: boolean;
}

/** Persisted record of the last core load, for change detection. */
export interface PersonaCoreState {
  path: string;
  hash: string | null;
  entryCount: number;
  loaded: boolean;
  reason: string | null;
  updatedAt: string;
}

/** Seed source kinds accepted by the persona seed importer (M14c). */
export type PersonaSeedSourceKind = 'persona' | 'soul';

export interface PersonaSeedSourceInput {
  /** Path relative to `PERSONA_SEED_ROOT`. */
  path: string;
  kind: PersonaSeedSourceKind;
}

export interface PersonaSeedImportResult {
  userId: string;
  agentId: string;
  seedRoot: string;
  importedAt: string;
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  conflictsStaged: number;
  skipped: number;
  sourceFiles: string[];
  recordIds: string[];
  changedRecordIds: string[];
  candidateIds: string[];
  warnings: string[];
}

/** Grounding evaluation result (M14d). Core is a hard gate. */
export interface PersonaGroundingResult {
  coreLoaded: boolean;
  identityGrounded: boolean;
  userKnown: boolean;
  relationshipCurrent: boolean;
  identityRecordCount: number;
  userFactCount: number;
  /** Hours since the relationship state was written; -1 when absent. */
  relationshipStateAgeHours: number;
  overallScore: number;
  needsWarmup: boolean;
  details: string[];
}

/** One provenance-bearing line of the grounding bundle. */
export interface PersonaGroundingEntry {
  id: string;
  layer: 'core' | 'identity' | 'user';
  category: string;
  content: string;
  confidence: number;
  protected: boolean;
  immutable: boolean;
  source: string;
  updatedAt: string;
}

export interface PersonaGroundingBundle {
  userId: string;
  generatedAt: string;
  entries: PersonaGroundingEntry[];
  relationship: PersonaRelationship | null;
  /** Prompt-ready, provenance-tagged band. */
  promptText: string;
  truncated: boolean;
}

export interface PersonaGroundingStatus {
  result: PersonaGroundingResult;
  bundle: PersonaGroundingBundle;
}

/** Review outcomes for a staged persona candidate (M14f). */
export type PersonaReviewOutcome =
  | 'approve_to_identity'
  | 'approve_to_user_model'
  | 'approve_to_relationship'
  | 'reject'
  | 'archive_as_transient'
  | 'needs_more_evidence';

export interface PersonaReviewInput {
  outcome: PersonaReviewOutcome;
  reviewedBy: string;
  reason: string;
}

export interface PersonaReviewResult {
  candidateId: string;
  outcome: PersonaReviewOutcome;
  applied: boolean;
  refused: boolean;
  refusalReason?: string;
  target?: 'persona_record' | 'persona_user_model' | 'persona_relationship';
  targetId?: string;
  driftLogId: string;
  conflictWithCoreEntryId?: string;
}

/** A persisted semantic-trend row for a record (M15c). */
export interface PersonaDriftTrend {
  id: number;
  recordId: string;
  reviewCycle: number;
  cosine: number;
  wasserstein: number;
  entropy: number;
  tokenOverlap: number;
  editRatio: number;
  embeddingCosine: number | null;
  signal: number;
  severity: PersonaDriftSeverity;
  observedAt: string;
}

export interface RecordPersonaDriftTrendInput {
  recordId: string;
  cosine: number;
  wasserstein: number;
  entropy: number;
  tokenOverlap: number;
  editRatio: number;
  embeddingCosine?: number | null;
  signal: number;
  severity: PersonaDriftSeverity;
  occurredAt?: string;
}

export interface UpdatePersonaCandidateReviewInput {
  candidateId: string;
  outcome: PersonaReviewOutcome;
  reviewedBy: string;
  reason: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}
