/**
 * M15.5 failure-mode catalogue (M15.5a).
 *
 * The observable hallucination failure modes — an output the model asserts
 * that its own evidence does not support, or that the store already
 * contradicts — each with the layer that detects it and the severity it
 * carries. Defined before detection so findings are regression-tested
 * against declared expectations, and so severity is sourced from here
 * rather than chosen at detection time.
 *
 * Deterministic first (M15.5b): evidence is the arbiter, so most modes are
 * decidable without a model. Secondary-model verification (M15.5c) is the
 * one layer reserved for claims neither evidence nor a single pass can
 * resolve — and it is an input, never the authority.
 */

export type HallucinationFailureMode =
  | 'unsupported_claim'
  | 'contradicted_claim'
  | 'fabricated_provenance'
  | 'overconfident_uncertainty'
  | 'silent_self_correction'
  | 'unverifiable_high_stakes';

export type HallucinationDetectionLayer = 'deterministic' | 'secondary_model';

export type HallucinationSeverity = 'info' | 'watch' | 'warning' | 'critical';

export interface HallucinationFailureModeSpec {
  mode: HallucinationFailureMode;
  layer: HallucinationDetectionLayer;
  severity: HallucinationSeverity;
  description: string;
}

export const HALLUCINATION_FAILURE_MODES: readonly HallucinationFailureModeSpec[] =
  [
    {
      mode: 'unsupported_claim',
      layer: 'deterministic',
      severity: 'warning',
      description:
        'An assertion the evidence ledger does not support (and does not contradict).',
    },
    {
      mode: 'contradicted_claim',
      layer: 'deterministic',
      severity: 'critical',
      description:
        'An assertion the store already contradicts with higher-confidence evidence.',
    },
    {
      mode: 'fabricated_provenance',
      layer: 'deterministic',
      severity: 'critical',
      description:
        'A claim citing evidence that does not exist or does not support it.',
    },
    {
      mode: 'overconfident_uncertainty',
      layer: 'deterministic',
      severity: 'watch',
      description:
        'High asserted confidence on a claim whose support is weak or absent.',
    },
    {
      mode: 'silent_self_correction',
      layer: 'deterministic',
      severity: 'warning',
      description:
        'Output changed without a recorded mitigation — the untraceable behaviour this project exists to prevent.',
    },
    {
      mode: 'unverifiable_high_stakes',
      layer: 'secondary_model',
      severity: 'watch',
      description:
        'A high-stakes claim neither the evidence nor a deterministic pass can resolve; a second model must assess it.',
    },
  ];

/** Severity by mode, sourced from the catalogue (single source of truth). */
export const HALLUCINATION_SEVERITY: Record<
  HallucinationFailureMode,
  HallucinationSeverity
> = Object.fromEntries(
  HALLUCINATION_FAILURE_MODES.map((spec) => [spec.mode, spec.severity]),
) as Record<HallucinationFailureMode, HallucinationSeverity>;

/**
 * Benign baselines: situations that must raise **no** finding. The M15.5e
 * false-positive matrix walks these.
 */
export interface HallucinationBenignBaseline {
  name: string;
  description: string;
}

export const HALLUCINATION_BENIGN_BASELINES: readonly HallucinationBenignBaseline[] =
  [
    {
      name: 'novel-but-uncontradicted',
      description:
        'A new, unsupported but uncontradicted claim — novelty is not failure; flag, never refuse.',
    },
    {
      name: 'supported-claim',
      description: 'An assertion with adequate evidence behind it.',
    },
    {
      name: 'appropriately-hedged',
      description:
        'Low stated confidence on weak support — honest uncertainty, not a failure.',
    },
    {
      name: 'recorded-disagreement',
      description:
        'Two models disagree and the disagreement is recorded, not silently resolved.',
    },
    {
      name: 'low-stakes-uncertainty',
      description:
        'An uncertain claim on a low-stakes matter, left for the user.',
    },
  ];

/**
 * Default thresholds (M15.5b/c). Config may override; these document the
 * intended numbers in one place.
 */
export const HALLUCINATION_DEFAULTS = {
  /** Evidence at/above this confidence counts as support. */
  supportConfidenceFloor: 0.5,
  /** Asserted confidence at/above this on weak support is overconfident. */
  highStakesConfidenceFloor: 0.8,
} as const;

/** What ICOS does with a finding (M15.5d). Explicit actions only. */
export type MitigationStrategy =
  'none' | 'flag' | 're_ground' | 'defer' | 'refuse';

export const MITIGATION_STRATEGIES: readonly MitigationStrategy[] = [
  'none',
  'flag',
  're_ground',
  'defer',
  'refuse',
];

/** Strategy per severity. Config may override; these are the defaults. */
export type MitigationPosture = Record<
  HallucinationSeverity,
  MitigationStrategy
>;

/**
 * Conservative defaults: never present an unresolvable/contradicted claim
 * as settled. `critical` refuses; `warning`/`watch` flag (annotate, do not
 * silently rewrite); `info` does nothing. An operator can raise a tier to
 * `re_ground` or `defer`.
 */
export const DEFAULT_MITIGATION_POSTURE: MitigationPosture = {
  info: 'none',
  watch: 'flag',
  warning: 'flag',
  critical: 'refuse',
};
