import {
  PERSONA_BENIGN_BASELINES,
  PERSONA_DRIFT_DEFAULTS,
  PERSONA_DRIFT_SEVERITY,
  PERSONA_FAILURE_MODES,
} from './persona-drift';

describe('persona drift failure-mode catalogue (M15a)', () => {
  it('names every mode with a layer and a severity', () => {
    for (const spec of PERSONA_FAILURE_MODES) {
      expect(spec.layer).toMatch(/^(structural|semantic|cumulative)$/);
      expect(spec.description.length).toBeGreaterThan(10);
      expect(PERSONA_DRIFT_SEVERITY[spec.mode]).toBe(spec.severity);
    }
  });

  it('covers the planned modes exactly once', () => {
    expect(PERSONA_FAILURE_MODES.map((spec) => spec.mode).sort()).toEqual(
      [
        'core_contradiction',
        'cumulative_semantic_drift',
        'grounding_score_low',
        'identity_contradiction',
        'protected_contradiction',
        'relationship_state_stale',
        'repeated_candidate_pressure',
        'semantic_drift',
      ].sort(),
    );
  });

  it('raises the stakes for the core above everything but cumulative', () => {
    expect(PERSONA_DRIFT_SEVERITY.core_contradiction).toBe('critical');
    expect(PERSONA_DRIFT_SEVERITY.protected_contradiction).toBe('critical');
    expect(PERSONA_DRIFT_SEVERITY.cumulative_semantic_drift).toBe('cumulative');
    expect(PERSONA_DRIFT_SEVERITY.relationship_state_stale).toBe('watch');
    expect(PERSONA_DRIFT_SEVERITY.repeated_candidate_pressure).toBe('watch');
    expect(PERSONA_DRIFT_SEVERITY.grounding_score_low).toBe('warning');
  });

  it('declares benign baselines the detectors must not fire on', () => {
    expect(PERSONA_BENIGN_BASELINES.length).toBeGreaterThanOrEqual(5);
    expect(PERSONA_BENIGN_BASELINES.map((baseline) => baseline.name)).toContain(
      'identical-content',
    );
  });

  it('documents the default thresholds', () => {
    expect(PERSONA_DRIFT_DEFAULTS).toMatchObject({
      relationshipFreshHours: 48,
      candidatePressureCount: 3,
      groundingWarmupThreshold: 0.6,
      cumulativeMinCycles: 3,
    });
  });
});
