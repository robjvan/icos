import {
  isValidSecretName,
  parseSecretReference,
  vaultReference,
} from './reference';

describe('parseSecretReference', () => {
  it('parses env references', () => {
    expect(parseSecretReference('$A')).toEqual({ kind: 'env', name: 'A' });
    expect(parseSecretReference('${A_B1}')).toEqual({
      kind: 'env',
      name: 'A_B1',
    });
  });

  it('parses vault references', () => {
    expect(parseSecretReference('secret:bytestash')).toEqual({
      kind: 'vault',
      name: 'bytestash',
    });
    expect(parseSecretReference('secret:openrouter.key')).toEqual({
      kind: 'vault',
      name: 'openrouter.key',
    });
  });

  it('rejects literals and malformed references', () => {
    for (const bad of [
      'literal',
      '',
      '$',
      '$1A',
      'secret:',
      'secret:-bad',
      'secret:a b',
      'secret:' + 'x'.repeat(65),
    ]) {
      expect(parseSecretReference(bad)).toBeNull();
    }
  });
});

describe('isValidSecretName', () => {
  it('accepts dns-like names and rejects the rest', () => {
    expect(isValidSecretName('bytestash')).toBe(true);
    expect(isValidSecretName('openrouter.key-2')).toBe(true);
    expect(isValidSecretName('-bad')).toBe(false);
    expect(isValidSecretName('has space')).toBe(false);
    expect(isValidSecretName('')).toBe(false);
    expect(isValidSecretName('x'.repeat(65))).toBe(false);
  });

  it('builds a canonical vault reference', () => {
    expect(vaultReference('bytestash')).toBe('secret:bytestash');
  });
});
