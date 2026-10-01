import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultProvidersPath,
  loadProviderCatalog,
  parseProviderCatalog,
  resolveProvidersPath,
} from './provider-catalog';

describe('parseProviderCatalog', () => {
  it('accepts well-formed entries and an active map', () => {
    const catalog = parseProviderCatalog({
      active: { conversation: 'openrouter', memory: 'local' },
      providers: [
        {
          id: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'deepseek/x',
          apiKeyRef: 'secret:openrouter',
          headers: { 'HTTP-Referer': '$REFERER' },
          timeoutMs: 30000,
        },
        { id: 'local', baseUrl: 'http://localhost:11434/v1', model: 'gemma' },
      ],
    });
    expect(catalog.errors).toEqual([]);
    expect(catalog.active).toEqual({
      conversation: 'openrouter',
      memory: 'local',
    });
    expect(catalog.providers.map((p) => p.id)).toEqual(['openrouter', 'local']);
  });

  it('rejects bad entries individually and skips them', () => {
    const catalog = parseProviderCatalog({
      providers: [
        { id: 'ok', baseUrl: 'http://x/v1', model: 'm' },
        { id: 'bad id!', baseUrl: 'http://x/v1', model: 'm' },
        { id: 'nourl', baseUrl: 'not a url', model: 'm' },
        { id: 'nomodel', baseUrl: 'http://x/v1' },
        {
          id: 'literal',
          baseUrl: 'http://x/v1',
          model: 'm',
          apiKeyRef: 'sk-plaintext',
        },
        {
          id: 'badheader',
          baseUrl: 'http://x/v1',
          model: 'm',
          headers: { A: 'literal' },
        },
        { id: 'badtimeout', baseUrl: 'http://x/v1', model: 'm', timeoutMs: 0 },
      ],
    });
    expect(catalog.providers.map((p) => p.id)).toEqual(['ok']);
    expect(catalog.errors.length).toBeGreaterThan(5);
  });

  it('keeps the first duplicate and reports the rest', () => {
    const catalog = parseProviderCatalog({
      providers: [
        { id: 'dup', baseUrl: 'http://a/v1', model: 'm' },
        { id: 'dup', baseUrl: 'http://b/v1', model: 'm' },
      ],
    });
    expect(catalog.providers).toHaveLength(1);
    expect(catalog.providers[0]?.baseUrl).toBe('http://a/v1');
    expect(catalog.errors.join(' ')).toContain('duplicate');
  });

  it('reports active entries that reference unknown providers', () => {
    const catalog = parseProviderCatalog({
      active: { conversation: 'ghost' },
      providers: [{ id: 'real', baseUrl: 'http://x/v1', model: 'm' }],
    });
    expect(catalog.active.conversation).toBeUndefined();
    expect(catalog.errors.join(' ')).toContain('ghost');
  });

  it('reports a non-object root or missing providers array', () => {
    expect(parseProviderCatalog([]).errors).toHaveLength(1);
    expect(parseProviderCatalog({}).errors).toContain(
      '"providers" must be an array',
    );
  });
});

describe('loadProviderCatalog', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-providers-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a catalog file with its path', () => {
    const path = join(dir, 'providers.json');
    writeFileSync(
      path,
      JSON.stringify({
        active: { conversation: 'a' },
        providers: [{ id: 'a', baseUrl: 'http://x/v1', model: 'm' }],
      }),
    );
    const loaded = loadProviderCatalog(path);
    expect(loaded.providers.map((p) => p.id)).toEqual(['a']);
    expect(loaded.path).toBe(path);
  });

  it('treats a missing file as an empty catalog and reports bad JSON', () => {
    expect(loadProviderCatalog(join(dir, 'missing.json'))).toMatchObject({
      providers: [],
      errors: [],
      path: '',
    });
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{nope');
    expect(loadProviderCatalog(broken).errors).toHaveLength(1);
  });

  it('resolves a default location under the data root', () => {
    expect(defaultProvidersPath()).toContain('.icos');
    expect(resolveProvidersPath('')).toBe(defaultProvidersPath());
  });
});
