import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultCatalogPath,
  loadCatalogFile,
  parseCatalog,
  parseEnvReference,
  resolveServerEnv,
} from './mcp-server-config';

describe('parseCatalog', () => {
  it('accepts stdio and http entries', () => {
    const catalog = parseCatalog([
      { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'x'] },
      { name: 'fetch', transport: 'http', url: 'http://localhost:3000/mcp' },
    ]);
    expect(catalog.errors).toEqual([]);
    expect(catalog.entries).toMatchObject([
      {
        name: 'files',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'x'],
      },
      { name: 'fetch', transport: 'http', url: 'http://localhost:3000/mcp' },
    ]);
  });

  it('rejects bad entries individually without blocking the rest', () => {
    const catalog = parseCatalog([
      { name: 'Good', transport: 'stdio', command: 'x' },
      { name: 'bad name!', transport: 'stdio', command: 'x' },
      { name: 'notransport' },
      { name: 'nocommand', transport: 'stdio' },
      { name: 'nourl', transport: 'http' },
      {
        name: 'badapproval',
        transport: 'stdio',
        command: 'x',
        approval: 'maybe',
      },
      'just a string',
    ]);
    expect(catalog.entries.map((entry) => entry.name)).toEqual(['good']);
    expect(catalog.errors.length).toBeGreaterThan(0);
  });

  it('keeps the first duplicate, reports the rest', () => {
    const catalog = parseCatalog([
      { name: 'dup', transport: 'stdio', command: 'a' },
      { name: 'dup', transport: 'stdio', command: 'b' },
    ]);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.command).toBe('a');
    expect(catalog.errors.join(' ')).toContain('duplicate');
  });

  it('rejects non-array roots', () => {
    expect(parseCatalog({})).toMatchObject({ entries: [] });
    expect(parseCatalog({}).errors).toHaveLength(1);
  });

  it('honors enabled flags and approval overrides', () => {
    const catalog = parseCatalog([
      {
        name: 'quiet',
        transport: 'stdio',
        command: 'x',
        enabled: false,
        approval: 'none',
      },
    ]);
    expect(catalog.entries[0]).toMatchObject({
      enabled: false,
      approval: 'none',
    });
  });

  it('accepts $VAR env references, rejects literals and http env', () => {
    const catalog = parseCatalog([
      {
        name: 'keyed',
        transport: 'stdio',
        command: 'x',
        env: { API_KEY: '$BYTESTASH_KEY', OTHER: '${OTHER_KEY}' },
      },
      {
        name: 'literal',
        transport: 'stdio',
        command: 'x',
        env: { API_KEY: 'sk-live-plaintext-secret' },
      },
      {
        name: 'web',
        transport: 'http',
        url: 'http://localhost:3000/mcp',
        env: { API_KEY: '$K' },
      },
    ]);
    expect(catalog.entries.map((entry) => entry.name)).toEqual(['keyed']);
    expect(catalog.errors.join(' ')).toContain('literal');
    expect(catalog.errors.join(' ')).toContain('stdio-only');
  });
});

describe('parseEnvReference', () => {
  it('parses $VAR and ${VAR}, rejects everything else', () => {
    expect(parseEnvReference('$A')).toEqual({ name: 'A' });
    expect(parseEnvReference('${A_B1}')).toEqual({ name: 'A_B1' });
    for (const bad of ['', 'literal', '$', '$1A', '${}', '$A B', '$$A']) {
      expect(parseEnvReference(bad)).toBeNull();
    }
  });
});

describe('resolveServerEnv', () => {
  const VAR = 'ICOS_TEST_RESOLVE_ME';

  afterEach(() => {
    delete process.env[VAR];
  });

  it('resolves references at spawn time, failing closed on missing', () => {
    process.env[VAR] = 's3cret';
    expect(resolveServerEnv({ KEY: `$${VAR}` }, 'srv')).toEqual({
      KEY: 's3cret',
    });
    // Empty counts as missing: no empty-string secrets.
    process.env[VAR] = '';
    expect(() => resolveServerEnv({ KEY: `$${VAR}` }, 'srv')).toThrow(VAR);
    delete process.env[VAR];
    expect(() => resolveServerEnv({ KEY: `$${VAR}` }, 'srv')).toThrow(VAR);
    // The throw names the variable, never any value.
    process.env[VAR] = 's3cret';
    try {
      resolveServerEnv({ KEY: '$MISSING_VAR_XYZ', EXTRA: `$${VAR}` }, 'srv');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('MISSING_VAR_XYZ');
      expect((err as Error).message).not.toContain('s3cret');
    }
  });
});

describe('loadCatalogFile', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-mcp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a catalog file with its path', () => {
    const path = join(dir, 'mcp-servers.json');
    writeFileSync(
      path,
      JSON.stringify([{ name: 'a', transport: 'stdio', command: 'x' }]),
    );
    const loaded = loadCatalogFile(path);
    expect(loaded.entries.map((entry) => entry.name)).toEqual(['a']);
    expect(loaded.path).toBe(path);
  });

  it('treats a missing file as an empty catalog', () => {
    const loaded = loadCatalogFile(join(dir, 'missing.json'));
    expect(loaded).toMatchObject({ entries: [], errors: [], path: '' });
  });

  it('reports unparseable files without throwing', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{nope');
    const loaded = loadCatalogFile(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.errors).toHaveLength(1);
  });

  it('defaults inside the shared data root', () => {
    expect(defaultCatalogPath()).toContain('.icos');
    expect(defaultCatalogPath()).toContain('mcp-servers.json');
  });
});
