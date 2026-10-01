import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { generateMasterKey } from './file-vault';
import { createVaultStore } from './secrets.module';
import { DisabledSecretStore, EnvSecretStore } from './secret-store';
import { SecretResolver } from './secret-resolver';

function configFor(overrides: Partial<CoreConfig>): CoreConfig {
  return {
    authDirPath: '/tmp/icos-unused-auth',
    ...overrides,
  } as CoreConfig;
}

describe('EnvSecretStore', () => {
  it('reads present values and refuses writes', () => {
    const store = new EnvSecretStore({ PRESENT: 'yes' });
    expect(store.writable).toBe(false);
    expect(store.has('PRESENT')).toBe(true);
    expect(store.get('PRESENT')).toBe('yes');
    expect(store.get('MISSING')).toBeNull();
    expect(() => store.put('X', 'y')).toThrow(/read-only/);
    expect(store.list()).toEqual([]);
  });
});

describe('DisabledSecretStore', () => {
  it('misses reads and refuses writes with a clear reason', () => {
    const store = new DisabledSecretStore();
    expect(store.writable).toBe(false);
    expect(store.get('a')).toBeNull();
    expect(() => store.put('a', 'x')).toThrow(/disabled/);
    expect(() => store.delete('a')).toThrow(/disabled/);
  });
});

describe('createVaultStore', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-vault-cfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is disabled when there is no key and no vault', () => {
    const store = createVaultStore(
      configFor({ vaultPath: join(dir, 'v.vault') }),
    );
    expect(store).toBeInstanceOf(DisabledSecretStore);
  });

  it('fails loudly when the vault has content but no key', () => {
    const path = join(dir, 'v.vault');
    writeFileSync(path, JSON.stringify({ version: 1, entries: { a: {} } }));
    expect(() => createVaultStore(configFor({ vaultPath: path }))).toThrow(
      /no master key/,
    );
  });

  it('is writable when a key is configured', () => {
    const path = join(dir, 'v.vault');
    const store = createVaultStore(
      configFor({ vaultPath: path, vaultKey: generateMasterKey() }),
    );
    expect(store.writable).toBe(true);
    store.put('a', 'value');
    expect(store.get('a')).toBe('value');
  });
});

describe('SecretResolver', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-resolver-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves env and vault references, on demand', () => {
    const store = createVaultStore(
      configFor({
        vaultPath: join(dir, 'v.vault'),
        vaultKey: generateMasterKey(),
      }),
    );
    store.put('bytestash', 'Bearer tok');
    const env = new EnvSecretStore({ LLM_KEY: 'sk-123' });
    const resolver = new SecretResolver(store, env);

    expect(resolver.resolve('secret:bytestash')).toBe('Bearer tok');
    expect(resolver.resolve('$LLM_KEY')).toBe('sk-123');
    expect(resolver.resolve('secret:missing')).toBeNull();
    expect(resolver.resolve('a literal')).toBeNull();

    // Rotation is visible immediately (no caching).
    store.put('bytestash', 'Bearer rotated');
    expect(resolver.resolve('secret:bytestash')).toBe('Bearer rotated');

    // Deletion fails closed.
    store.delete('bytestash');
    expect(resolver.resolve('secret:bytestash')).toBeNull();
  });
});
