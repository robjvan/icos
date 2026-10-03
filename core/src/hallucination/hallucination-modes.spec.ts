import {
  HALLUCINATION_BENIGN_BASELINES,
  HALLUCINATION_DEFAULTS,
  HALLUCINATION_FAILURE_MODES,
  HALLUCINATION_SEVERITY,
} from './hallucination-modes';

describe('hallucination failure-mode catalogue (M15.5a)', () => {
  it('names every mode with a layer and a severity', () => {
    for (const spec of HALLUCINATION_FAILURE_MODES) {
      expect(spec.layer).toMatch(/^(deterministic|secondary_model)$/);
      expect(spec.description.length).toBeGreaterThan(10);
      expect(HALLUCINATION_SEVERITY[spec.mode]).toBe(spec.severity);
    }
  });

  it('covers the planned modes exactly once', () => {
    expect(HALLUCINATION_FAILURE_MODES.map((spec) => spec.mode).sort()).toEqual(
      [
        'contradicted_claim',
        'fabricated_provenance',
        'overconfident_uncertainty',
        'silent_self_correction',
        'unsupported_claim',
        'unverifiable_high_stakes',
      ].sort(),
    );
  });

  it('raises contradictions and fabricated provenance above the rest', () => {
    expect(HALLUCINATION_SEVERITY.contradicted_claim).toBe('critical');
    expect(HALLUCINATION_SEVERITY.fabricated_provenance).toBe('critical');
    expect(HALLUCINATION_SEVERITY.unsupported_claim).toBe('warning');
    expect(HALLUCINATION_SEVERITY.silent_self_correction).toBe('warning');
    expect(HALLUCINATION_SEVERITY.overconfident_uncertainty).toBe('watch');
  });

  it('reserves the secondary-model layer for the genuinely unresolvable', () => {
    const secondary = HALLUCINATION_FAILURE_MODES.filter(
      (spec) => spec.layer === 'secondary_model',
    );
    expect(secondary.map((spec) => spec.mode)).toEqual([
      'unverifiable_high_stakes',
    ]);
  });

  it('declares benign baselines that must not fire', () => {
    const names = HALLUCINATION_BENIGN_BASELINES.map(
      (baseline) => baseline.name,
    );
    expect(names).toContain('novel-but-uncontradicted');
    expect(names).toContain('recorded-disagreement');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it('documents the default thresholds', () => {
    expect(HALLUCINATION_DEFAULTS).toMatchObject({
      supportConfidenceFloor: 0.5,
      highStakesConfidenceFloor: 0.8,
    });
  });
});
