import { describe, expect, it } from 'vitest';

import { categoryFromKind, claimObjectLabel, claimStatement, claimTone } from './claim';

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

describe('claimObjectLabel', () => {
  it('marks negated rivals so they never render identically', () => {
    expect(claimObjectLabel({ object: 'TypeScript', negated: false })).toBe(
      '"TypeScript"',
    );
    expect(claimObjectLabel({ object: 'TypeScript', negated: true })).toBe(
      'not "TypeScript"',
    );
  });
});

describe('claimStatement', () => {
  it('renders the full belief with its marker', () => {
    expect(
      claimStatement({
        subject: 'user',
        predicate: 'prefers',
        object: 'Rust',
        negated: false,
      }),
    ).toBe('user prefers "Rust"');
    expect(
      claimStatement({
        subject: 'user',
        predicate: 'prefers',
        object: 'TypeScript',
        negated: true,
      }),
    ).toBe('user prefers not "TypeScript"');
  });
});
