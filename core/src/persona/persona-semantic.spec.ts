import {
  compareContent,
  cosineSimilarity,
  editDistance,
  embeddingCosine,
  normalizedEntropy,
  tokenDistribution,
  wasserstein1,
} from './persona-semantic';

describe('persona semantic measures (M15c)', () => {
  it('treats identical content as zero drift', () => {
    const comparison = compareContent(
      'Be honest about uncertainty.',
      'Be honest about uncertainty.',
    );
    expect(comparison.identical).toBe(true);
    expect(comparison.signal).toBe(0);
    expect(comparison.wasserstein).toBe(0);
  });

  it('scores a restatement below a meaning shift', () => {
    const restatement = compareContent(
      'Be honest about uncertainty.',
      'Be honest about what is uncertain.',
    );
    const shift = compareContent(
      'Be honest about uncertainty.',
      'Prefer comfortable reassurance over truth.',
    );
    expect(shift.signal).toBeGreaterThan(restatement.signal);
    expect(shift.signal).toBeGreaterThan(0.5);
  });

  it('computes the Wasserstein-1 distributional distance', () => {
    const a = tokenDistribution('alpha beta gamma');
    const b = tokenDistribution('alpha beta gamma');
    const disjoint = tokenDistribution('delta epsilon zeta');
    expect(wasserstein1(a, b)).toBe(0);
    expect(wasserstein1(a, disjoint)).toBeCloseTo(1, 10);
    const partial = tokenDistribution('alpha beta');
    const distance = wasserstein1(a, partial);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1);
  });

  it('normalizes Shannon entropy by the observed bins', () => {
    expect(normalizedEntropy(tokenDistribution('one'))).toBe(0);
    const uniform = normalizedEntropy(
      tokenDistribution('alpha beta gamma delta'),
    );
    expect(uniform).toBeCloseTo(1, 6);
  });

  it('reports cosine and the simpler baselines together', () => {
    const left = tokenDistribution('alpha beta gamma');
    const right = tokenDistribution('alpha beta gamma');
    expect(cosineSimilarity(left, right)).toBeCloseTo(1, 6);

    const comparison = compareContent('alpha beta gamma', 'alpha beta delta');
    expect(comparison.tokenOverlap).toBeGreaterThan(0);
    expect(comparison.editDistance).toBeGreaterThan(0);
    expect(comparison.editRatio).toBeGreaterThan(0);
    expect(comparison.signal).toBe(
      Math.max(1 - comparison.cosine, comparison.wasserstein),
    );
  });

  it('measures edit distance and embedding cosine directly', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
    expect(embeddingCosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(embeddingCosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
});
