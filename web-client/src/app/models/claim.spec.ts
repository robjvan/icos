import { describe, expect, it } from 'vitest';

import { categoryFromKind, claimTone } from './claim';

describe('claimTone', () => {
  it('maps every lifecycle status to its tone', () => {
    expect(claimTone('active')).toBe('active');
    expect(claimTone('candidate')).toBe('candidate');
    expect(claimTone('contradicted')).toBe('contradicted');
    expect(claimTone('retired')).toBe('retired');
  });
});

describe('categoryFromKind', () => {
  it('maps preference and relationship, defaults to fact', () => {
    expect(categoryFromKind('preference')).toBe('preference');
    expect(categoryFromKind('relationship')).toBe('relationship');
    expect(categoryFromKind('fact')).toBe('fact');
    expect(categoryFromKind('goal')).toBe('fact');
  });
});
