/** Persona surfaces (M14). Mirrors the core persona DTOs. */

export type PersonaCoreCategory =
  | 'ethical_grounding'
  | 'core_belief'
  | 'safety_boundary'
  | 'non_negotiable'
  | 'agentic_character';

export interface PersonaCoreEntry {
  entryId: string;
  category: PersonaCoreCategory;
  content: string;
  immutable: true;
}

export interface PersonaCoreView {
  loaded: boolean;
  path: string;
  hash: string | null;
  entryCount: number;
  evaluatedAt: string;
  reason?: string;
  changedSinceLastLoad: boolean;
  entries: readonly PersonaCoreEntry[];
}

export type PersonaReviewOutcome =
  | 'approve_to_identity'
  | 'approve_to_user_model'
  | 'approve_to_relationship'
  | 'reject'
  | 'archive_as_transient'
  | 'needs_more_evidence';

export type PersonaProposedTarget =
  | 'persona_record'
  | 'persona_user_model'
  | 'persona_relationship';

export interface PersonaCandidate {
  candidateId: string;
  userId: string;
  observation: string;
  category: string;
  confidence: number;
  sessionId: string | null;
  source: string;
  sourceTurnId: string | null;
  claimId: string | null;
  proposedTarget: PersonaProposedTarget | null;
  status: 'pending' | 'reviewed';
  reviewOutcome: string | null;
  reviewReason: string | null;
  reviewedBy: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
}

export interface PersonaRecord {
  recordId: string;
  userId: string;
  category: string;
  content: string;
  confidence: number;
  sensitivity: string;
  protected: boolean;
  source: string;
  updatedAt: string;
}

export interface PersonaUserFact {
  memoryId: string;
  userId: string;
  content: string;
  confidence: number;
  source: string;
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
  updatedAt: string;
}

export interface PersonaOverview {
  records: readonly PersonaRecord[];
  userFacts: readonly PersonaUserFact[];
  relationship: PersonaRelationship | null;
}

export interface PersonaDriftEntry {
  logId: string;
  userId: string;
  subjectId: string;
  severity: string;
  changeType: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string;
  reviewed: boolean;
  createdAt: string;
}

export interface PersonaReviewResult {
  candidateId: string;
  outcome: PersonaReviewOutcome;
  applied: boolean;
  refused: boolean;
  refusalReason?: string;
  target?: PersonaProposedTarget;
  targetId?: string;
  driftLogId: string;
  conflictWithCoreEntryId?: string;
}
