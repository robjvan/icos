import type { PersonaDriftSeverity } from './persona.types';

/**
 * M15 failure-mode catalogue (M15a).
 *
 * The observable drift failure modes, each with the layer that detects it
 * and the severity it carries. This is the contract the detectors (M15b–d)
 * implement and the evaluation (M15e) checks against — defined *before*
 * detection so findings are regression-tested, not judged by vibes.
 *
 * Severity is deliberately fixed here, not chosen at detection time:
 * a detector reports the mode and this table supplies the severity, so an
 * honest severity cannot drift with the implementation.
 */

export type PersonaFailureMode =
  | 'core_contradiction'
  | 'protected_contradiction'
  | 'identity_contradiction'
  | 'relationship_state_stale'
  | 'repeated_candidate_pressure'
  | 'grounding_score_low'
  | 'semantic_drift'
  | 'cumulative_semantic_drift';

/** Which detection layer owns a failure mode. */
export type PersonaDriftLayer = 'structural' | 'semantic' | 'cumulative';

export interface PersonaFailureModeSpec {
  mode: PersonaFailureMode;
  layer: PersonaDriftLayer;
  severity: PersonaDriftSeverity;
  description: string;
}

export const PERSONA_FAILURE_MODES: readonly PersonaFailureModeSpec[] = [
  {
    mode: 'core_contradiction',
    layer: 'structural',
    severity: 'critical',
    description:
      'A candidate contradicts an immutable core entry. Non-applicable; the core never yields.',
  },
  {
    mode: 'protected_contradiction',
    layer: 'structural',
    severity: 'critical',
    description:
      'A candidate contradicts a protected evolving record (or its explicit target).',
  },
  {
    mode: 'identity_contradiction',
    layer: 'structural',
    severity: 'warning',
    description:
      'A candidate contradicts an unprotected evolving identity record.',
  },
  {
    mode: 'relationship_state_stale',
    layer: 'structural',
    severity: 'watch',
    description: 'The relationship state has aged past the freshness window.',
  },
  {
    mode: 'repeated_candidate_pressure',
    layer: 'structural',
    severity: 'watch',
    description:
      'Many similar unreviewed candidates accumulate toward an unreviewed change.',
  },
  {
    mode: 'grounding_score_low',
    layer: 'structural',
    severity: 'warning',
    description:
      'The overall grounding score falls below the warm-up threshold.',
  },
  {
    mode: 'semantic_drift',
    layer: 'semantic',
    severity: 'warning',
    description:
      'A record’s content has moved distributionally beyond the drift floor.',
  },
  {
    mode: 'cumulative_semantic_drift',
    layer: 'cumulative',
    severity: 'cumulative',
    description:
      'A record’s direction keeps moving across consecutive review cycles.',
  },
];

/** Severity by mode, sourced from the catalogue (single source of truth). */
export const PERSONA_DRIFT_SEVERITY: Record<
  PersonaFailureMode,
  PersonaDriftSeverity
> = Object.fromEntries(
  PERSONA_FAILURE_MODES.map((spec) => [spec.mode, spec.severity]),
) as Record<PersonaFailureMode, PersonaDriftSeverity>;

/**
 * Benign baselines: situations that must raise **no** finding. The M15e
 * false-positive matrix walks these; M15b–d tests assert detection does
 * not fire on them.
 */
export interface PersonaBenignBaseline {
  name: string;
  description: string;
}

export const PERSONA_BENIGN_BASELINES: readonly PersonaBenignBaseline[] = [
  {
    name: 'benign-candidate',
    description: 'A novel, non-contradicting candidate stages — no finding.',
  },
  {
    name: 'fresh-relationship',
    description: 'Relationship state updated within the freshness window.',
  },
  {
    name: 'single-candidate',
    description: 'One pending candidate — below the pressure threshold.',
  },
  {
    name: 'grounded-score',
    description: 'Grounding score at or above the warm-up threshold.',
  },
  {
    name: 'identical-content',
    description: 'Unchanged record content — zero semantic distance.',
  },
  {
    name: 'sub-threshold-movement',
    description: 'A small content edit below the semantic drift floor.',
  },
];

/**
 * Default thresholds (M15b/c). Config may override; these document the
 * intended defaults so a reader sees the numbers in one place.
 */
export const PERSONA_DRIFT_DEFAULTS = {
  relationshipFreshHours: 48,
  candidatePressureCount: 3,
  candidatePressureSimilarity: 0.6,
  groundingWarmupThreshold: 0.6,
  // Calibrated to the M15e corpus: best embedding F1 at 0.20 (P 0.75,
  // R 0.82). Provisional — revisit as the corpus grows.
  semanticDriftFloor: 0.2,
  semanticCriticalFloor: 0.5,
  cumulativeMinCycles: 3,
} as const;

/**
 * Semantic drift severity. The catalogue supplies the base (`warning`);
 * an extreme movement escalates to `critical`. This is the one place a
 * detector may raise above its catalogue severity, and only upward.
 */
export function semanticDriftSeverity(
  signal: number,
  criticalFloor: number = PERSONA_DRIFT_DEFAULTS.semanticCriticalFloor,
): PersonaDriftSeverity {
  return signal >= criticalFloor ? 'critical' : 'warning';
}
