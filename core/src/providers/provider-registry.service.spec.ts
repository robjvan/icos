import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import {
  generateMasterKey,
  FileVaultSecretStore,
  parseMasterKey,
} from '../secrets/file-vault';
import { EnvSecretStore } from '../secrets/secret-store';
import { SecretResolver } from '../secrets/secret-resolver';
import { ProviderRegistryService } from './provider-registry.service';

function configFor(overrides: Partial<CoreConfig>): CoreConfig {
  return {
    provider: 'ollama',
    llmBaseUrl: 'http://env-host/v1',
    llmModel: 'env-model',
    llmTimeoutMs: 1000,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://env-host/v1',
    memoryLlmModel: 'env-memory',
    memoryLlmTimeoutMs: 2000,
    ...overrides,
  } as CoreConfig;
}

describe('ProviderRegistryService', () => {
  let dir = '';
  let vaultPath = '';
  let providersPath = '';
  let resolver: SecretResolver;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-registry-'));
    vaultPath = join(dir, 'secrets.vault');
    providersPath = join(dir, 'providers.json');
    const vault = new FileVaultSecretStore(
      vaultPath,
      parseMasterKey(generateMasterKey()) as Buffer,
    );
    vault.put('openrouter', 'sk-vault-key');
    resolver = new SecretResolver(
      vault,
      new EnvSecretStore({ REFERER: 'https://ref' }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function registry(config: Partial<CoreConfig> = {}): ProviderRegistryService {
    const service = new ProviderRegistryService(
      configFor({ providersPath, ...config }),
      resolver,
    );
    service.onModuleInit();
    return service;
  }

  it('falls back to the env endpoints with no catalog', () => {
    const service = registry();
    expect(service.conversationEndpoint()).toEqual({
      provider: 'ollama',
      llmBaseUrl: 'http://env-host/v1',
      llmModel: 'env-model',
      llmApiKey: undefined,
      headers: undefined,
      userAgent: undefined,
      llmTimeoutMs: 1000,
    });
    expect(service.memoryEndpoint().llmModel).toBe('env-memory');
    expect(service.report().source).toBe('env');
  });

  it('resolves the active catalog provider, its key, and headers', () => {
    writeFileSync(
      providersPath,
      JSON.stringify({
        active: { conversation: 'openrouter', memory: 'local' },
        providers: [
          {
            id: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            model: 'deepseek/x',
            apiKeyRef: 'secret:openrouter',
            headers: { 'HTTP-Referer': '$REFERER' },
            userAgent: 'icos/test',
            timeoutMs: 1234,
          },
          { id: 'local', baseUrl: 'http://localhost:11434/v1', model: 'gemma' },
        ],
      }),
    );
    const service = registry();
    const conversation = service.conversationEndpoint();
    expect(conversation).toMatchObject({
      provider: 'openrouter',
      llmBaseUrl: 'https://openrouter.ai/api/v1',
      llmModel: 'deepseek/x',
      llmApiKey: 'sk-vault-key',
      headers: { 'HTTP-Referer': 'https://ref' },
      userAgent: 'icos/test',
      llmTimeoutMs: 1234,
    });
    expect(service.memoryEndpoint()).toMatchObject({
      provider: 'local',
      llmModel: 'gemma',
      // Memory role falls back to its own env timeout when unspecified.
      llmTimeoutMs: 2000,
    });

    const report = service.report();
    expect(report.source).toBe('catalog');
    expect(report.active).toEqual({
      conversation: 'openrouter',
      memory: 'local',
    });
    expect(report.providers.map((p) => `${p.id}:${p.hasKey}`)).toEqual([
      'openrouter:true',
      'local:false',
    ]);
    // Never a key in the report.
    expect(JSON.stringify(report)).not.toContain('sk-vault-key');
  });

  it('falls back per role when the active id is disabled or missing', () => {
    writeFileSync(
      providersPath,
      JSON.stringify({
        active: { conversation: 'off' },
        providers: [
          { id: 'off', baseUrl: 'http://x/v1', model: 'm', enabled: false },
        ],
      }),
    );
    const service = registry();
    expect(service.conversationEndpoint().provider).toBe('ollama');
    expect(service.report().active.conversation).toBe('ollama');
  });

  it('persists a selected active provider and reloads', () => {
    writeFileSync(
      providersPath,
      JSON.stringify({
        providers: [
          { id: 'a', baseUrl: 'http://a/v1', model: 'ma' },
          { id: 'b', baseUrl: 'http://b/v1', model: 'mb' },
        ],
      }),
    );
    const service = registry();
    expect(service.conversationEndpoint().llmModel).toBe('env-model');

    const report = service.setActive('conversation', 'b');
    expect(report.active.conversation).toBe('b');
    expect(service.conversationEndpoint().llmModel).toBe('mb');

    const onDisk = JSON.parse(readFileSync(providersPath, 'utf8')) as {
      active: { conversation?: string };
    };
    expect(onDisk.active.conversation).toBe('b');
    expect(() => service.setActive('conversation', 'ghost')).toThrow(
      /unknown or disabled/,
    );
  });

  it('adds and removes providers, keeping active consistent', () => {
    writeFileSync(
      providersPath,
      JSON.stringify({
        active: { conversation: 'a' },
        providers: [{ id: 'a', baseUrl: 'http://a/v1', model: 'ma' }],
      }),
    );
    const service = registry();

    const added = service.upsertProvider({
      id: 'b',
      baseUrl: 'http://b/v1',
      model: 'mb',
    });
    expect(added.providers.map((p) => p.id)).toEqual(['a', 'b']);
    expect(service.catalogEntries().map((p) => p.id)).toEqual(['a', 'b']);

    // Editing replaces in place.
    service.upsertProvider({ id: 'b', baseUrl: 'http://b/v2', model: 'mb2' });
    expect(service.catalogEntries()).toHaveLength(2);

    // Removing the active provider clears the active selection.
    const removed = service.removeProvider('a');
    expect(removed.providers.map((p) => p.id)).toEqual(['b']);
    expect(removed.active.conversation).toBe('ollama'); // env fallback

    expect(() => service.upsertProvider({ id: 'bad' })).toThrow(/baseUrl/);
  });

  it('tests a provider connection using the resolved key', async () => {
    writeFileSync(
      providersPath,
      JSON.stringify({
        providers: [
          {
            id: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            model: 'm',
            apiKeyRef: 'secret:openrouter',
          },
        ],
      }),
    );
    const service = registry();
    const fetchMock = jest.fn<
      Promise<{ ok: boolean; status: number }>,
      [string, { headers: Record<string, string> }]
    >(() => Promise.resolve({ ok: true, status: 200 }));
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof global.fetch;
    try {
      const result = await service.testConnection('openrouter');
      expect(result).toEqual({ ok: true, detail: 'HTTP 200' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/models');
      expect(init.headers['Authorization']).toBe('Bearer sk-vault-key');
    } finally {
      global.fetch = originalFetch;
    }

    expect(await service.testConnection('missing')).toMatchObject({
      ok: false,
    });
  });
});
