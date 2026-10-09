import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import { ImageGenError, ImageGenService } from './image-gen.service';

describe('ImageGenService', () => {
  let dir: string;
  const originalFetch = global.fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-img-'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
    return {
      imageGenProvider: 'openai',
      imageGenBaseUrl: 'https://api.example/v1',
      imageGenModel: 'gpt-image-1',
      imageGenOutputDir: dir,
      imageGenTimeoutMs: 5000,
      ...overrides,
    } as unknown as CoreConfig;
  }

  function secretsWith(value: string | null): {
    resolver: SecretResolver;
    resolve: jest.Mock;
  } {
    const resolve = jest.fn(() => value);
    return { resolver: { resolve } as unknown as SecretResolver, resolve };
  }

  function okResponse(body: string): Response {
    return new Response(body, { status: 200 });
  }

  it('reports unavailable when unconfigured', async () => {
    const { resolver } = secretsWith('k');
    const service = new ImageGenService(
      config({ imageGenProvider: undefined }),
      resolver,
    );
    expect(service.configured()).toBe(false);
    await expect(service.generate({ prompt: 'x' })).rejects.toMatchObject({
      code: 'image_gen_unavailable',
    });
  });

  it('generates via the OpenAI-compatible endpoint and writes the file', async () => {
    const payload = JSON.stringify({
      data: [{ b64_json: Buffer.from('PNGDATA').toString('base64') }],
      model: 'gpt-image-1',
    });
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(okResponse(payload)),
    );
    global.fetch = fetchMock;

    const { resolver } = secretsWith('k');
    const service = new ImageGenService(config(), resolver);
    const result = await service.generate({ prompt: 'a teal square' });

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-1',
      bytes: 7,
    });
    expect(result.path.startsWith(join(dir, 'generated'))).toBe(true);
    expect(readFileSync(result.path).toString()).toBe('PNGDATA');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('resolves a secret-reference key into the auth header', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(
        okResponse(JSON.stringify({ data: [{ b64_json: 'AAAA' }] })),
      ),
    );
    global.fetch = fetchMock;

    const { resolver, resolve } = secretsWith('resolved-key');
    const service = new ImageGenService(
      config({ imageGenApiKey: 'secret:IMAGE_KEY' }),
      resolver,
    );
    await service.generate({ prompt: 'x' });

    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer resolved-key',
    );
    expect(resolve).toHaveBeenCalledWith('secret:IMAGE_KEY');
  });

  it('fails closed when the endpoint errors', async () => {
    global.fetch = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(new Response('nope', { status: 500 })),
    );
    const { resolver } = secretsWith('k');
    const service = new ImageGenService(config(), resolver);
    await expect(service.generate({ prompt: 'x' })).rejects.toBeInstanceOf(
      ImageGenError,
    );
  });
});
