import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBootstrapToken, ensureSessionKey } from './secrets-files';

describe('secret files', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-auth-files-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a 0600 token once and returns the same value after', () => {
    const path = join(dir, 'nested', 'token');
    const first = ensureBootstrapToken(path);
    expect(first.created).toBe(true);
    expect(first.value.length).toBeGreaterThan(20);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const second = ensureBootstrapToken(path);
    expect(second.created).toBe(false);
    expect(second.value).toBe(first.value);
  });

  it('generates distinct, non-empty keys', () => {
    const a = ensureSessionKey(join(dir, 'k1'));
    const b = ensureSessionKey(join(dir, 'k2'));
    expect(a.value).not.toBe(b.value);
    expect(readFileSync(join(dir, 'k1'), 'utf8').trim()).toBe(a.value);
  });

  it('regenerates when the file is empty', () => {
    const path = join(dir, 'token');
    writeFileSync(path, '   \n');
    const regenerated = ensureBootstrapToken(path);
    expect(regenerated.created).toBe(true);
    expect(regenerated.value.trim()).not.toBe('');
  });
});
