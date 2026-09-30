import { tokenize } from './text-tokens';
import { shapeQuery } from './query-shaping';

describe('tokenize', () => {
  it('lowercases, splits, dedupes, and drops stopwords', () => {
    expect(tokenize('User PREFERS TypeScript')).toEqual([
      'user',
      'prefers',
      'typescript',
    ]);
    expect(tokenize('the user is a fan')).toEqual(['user', 'fan']);
    expect(tokenize('person:Ada working_on ICOS')).toEqual([
      'person',
      'ada',
      'working',
      'icos',
    ]);
  });

  it('never stops negation words', () => {
    expect(tokenize('user does not prefer Rust')).toContain('not');
    expect(tokenize('no longer likes Go')).toContain('no');
    expect(tokenize('never worked')).toContain('never');
  });
});

describe('shapeQuery', () => {
  it('trims and bounds turn text with tokens attached', () => {
    expect(shapeQuery('  what does the user prefer?  ')).toMatchObject({
      text: 'what does the user prefer?',
    });
    expect(shapeQuery('  what does the user prefer?  ').tokens).toContain(
      'prefer',
    );
    expect(shapeQuery('x'.repeat(600)).text).toHaveLength(500);
  });

  it('shapes slash-command arguments, never the verb', () => {
    expect(shapeQuery('/health')).toMatchObject({ text: '', tokens: [] });
    expect(shapeQuery('/search typescript tips')).toMatchObject({
      text: 'typescript tips',
    });
  });

  it('shapes empty input to empty', () => {
    expect(shapeQuery('   ')).toMatchObject({ text: '', tokens: [] });
  });
});
