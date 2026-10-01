import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileVaultSecretStore,
  generateMasterKey,
  loadMasterKey,
  parseMasterKey,
  vaultHasEntries,
} from './file-vault';

const KEY = parseMasterKey(generateMasterKey()) as Buffer;

describe('master key handling', () => {
  it('parses hex, base64, base64url, and raw 32-byte keys', () => {
    const raw = Buffer.alloc(32, 7);
    expect(parseMasterKey(raw.toString('hex'))).toEqual(raw);
    expect(parseMasterKey(raw.toString('base64'))).toEqual(raw);
    expect(parseMasterKey(raw.toString('base64url'))).toEqual(raw);
    expect(parseMasterKey('x'.repeat(32))).toEqual(Buffer.alloc(32, 0x78));
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(parseMasterKey('')).toBeNull();
    expect(parseMasterKey('too-short')).toBeNull();
    expect(parseMasterKey(Buffer.alloc(16).toString('base64'))).toBeNull();
  });

  it('loads from a file, preferring it, and fails on a malformed key', () => {
    const good = Buffer.alloc(32, 1).toString('base64');
    expect(loadMasterKey({ keyFile: '/k', readFile: () => good })).toEqual(
      Buffer.alloc(32, 1),
    );
    expect(loadMasterKey({ key: 'x'.repeat(32) })).toEqual(
      Buffer.alloc(32, 0x78),
    );
    expect(loadMasterKey({})).toBeNull();
    expect(() => loadMasterKey({ key: 'nope' })).toThrow(/32-byte/);
    expect(() =>
      loadMasterKey({ keyFile: '/k', readFile: () => 'nope' }),
    ).toThrow(/32-byte/);
  });
});

describe('FileVaultSecretStore', () => {
  let dir = '';
  let path = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-vault-'));
    path = join(dir, 'secrets.vault');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips put/get/list/delete and persists to a 0600 file', () => {
    const store = new FileVaultSecretStore(path, KEY);
    expect(store.writable).toBe(true);
    expect(store.get('a')).toBeNull();

    const created = store.put('a', 'value-a');
    expect(created.name).toBe('a');
    expect(store.get('a')).toBe('value-a');
    expect(statSync(path).mode & 0o777).toBe(0o600);

    // A second store (fresh process) reads the same value.
    const reopened = new FileVaultSecretStore(path, KEY);
    expect(reopened.get('a')).toBe('value-a');

    // Rotation keeps createdAt, bumps updatedAt.
    const rotated = store.put('a', 'value-a2');
    expect(rotated.createdAt).toBe(created.createdAt);
    expect(store.get('a')).toBe('value-a2');

    expect(store.list().map((entry) => entry.name)).toEqual(['a']);
    expect(store.delete('a')).toBe(true);
    expect(store.delete('a')).toBe(false);
    expect(store.get('a')).toBeNull();
  });

  it('binds each entry to its name (AAD) so entries cannot be swapped', () => {
    const store = new FileVaultSecretStore(path, KEY);
    store.put('a', 'value-a');
    store.put('b', 'value-b');

    const file = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: Record<string, unknown>;
    };
    file.entries['a'] = file.entries['b'];
    writeFileSync(path, JSON.stringify(file));

    const reopened = new FileVaultSecretStore(path, KEY);
    expect(reopened.get('a')).toBeNull(); // AAD mismatch → fails closed
    expect(reopened.get('b')).toBe('value-b');
  });

  it('fails closed on tampering or a wrong key', () => {
    const store = new FileVaultSecretStore(path, KEY);
    store.put('a', 'value-a');

    const file = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: Record<string, { ciphertext: string }>;
    };
    file.entries['a'].ciphertext = Buffer.from('garbage').toString('base64');
    writeFileSync(path, JSON.stringify(file));
    expect(new FileVaultSecretStore(path, KEY).get('a')).toBeNull();

    expect(new FileVaultSecretStore(path, KEY).has('a')).toBe(true);
  });

  it('rejects invalid names, empty values, and unsupported versions', () => {
    const store = new FileVaultSecretStore(path, KEY);
    expect(() => store.put('-bad', 'x')).toThrow(/invalid secret name/);
    expect(() => store.put('ok', '')).toThrow(/must not be empty/);

    writeFileSync(path, JSON.stringify({ version: 99, entries: {} }));
    expect(() => new FileVaultSecretStore(path, KEY)).toThrow(/version/);
    writeFileSync(path, '{ not json');
    expect(() => new FileVaultSecretStore(path, KEY)).toThrow(/valid JSON/);
  });
});

describe('vaultHasEntries', () => {
  it('is false for a missing/empty file and true for content or corruption', () => {
    const dir = mkdtempSync(join(tmpdir(), 'icos-vault-has-'));
    const path = join(dir, 'v.vault');
    try {
      expect(vaultHasEntries(path)).toBe(false);
      writeFileSync(path, JSON.stringify({ version: 1, entries: {} }));
      expect(vaultHasEntries(path)).toBe(false);
      writeFileSync(path, JSON.stringify({ version: 1, entries: { a: {} } }));
      expect(vaultHasEntries(path)).toBe(true);
      writeFileSync(path, 'not json');
      expect(vaultHasEntries(path)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
