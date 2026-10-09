import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { parseSecretReference } from '../secrets/reference';
import { SecretResolver } from '../secrets/secret-resolver';

const MAX_GENERATED_BYTES = 8 * 1024 * 1024;
const DEFAULT_SIZE = '1024x1024';

export interface GeneratedImage {
  /** Absolute path the image was written to. */
  path: string;
  provider: string;
  model: string;
  bytes: number;
}

/** Code-only failure; the executor maps it to a tool-failure code. */
export class ImageGenError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ImageGenError';
  }
}

/**
 * M17b.9 image generation. Provider-agnostic and config-first: an
 * unconfigured deployment reports `image_gen_unavailable` (never a fake
 * success). The OpenAI-compatible `/images/generations` backend ships
 * now; a ComfyUI backend (workflow-file driven) is a follow-up.
 */
@Injectable()
export class ImageGenService {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly secrets: SecretResolver,
  ) {}

  /** True when a provider and base URL are configured. */
  configured(): boolean {
    return (
      (this.config.imageGenProvider ?? '') !== '' &&
      !!this.config.imageGenBaseUrl
    );
  }

  async generate(input: {
    prompt: string;
    size?: string;
  }): Promise<GeneratedImage> {
    if (!this.configured()) throw new ImageGenError('image_gen_unavailable');
    const provider = this.config.imageGenProvider ?? '';
    if (provider === 'openai') return this.generateOpenai(input);
    throw new ImageGenError('image_gen_unsupported_provider');
  }

  private async generateOpenai(input: {
    prompt: string;
    size?: string;
  }): Promise<GeneratedImage> {
    const base = this.config.imageGenBaseUrl ?? '';
    const json = await this.postJson(`${base}/images/generations`, {
      model: this.config.imageGenModel,
      prompt: input.prompt,
      n: 1,
      size: input.size ?? DEFAULT_SIZE,
      response_format: 'b64_json',
    });
    const data = Array.isArray(json.data)
      ? (json.data[0] as Record<string, unknown> | undefined)
      : undefined;
    let bytes: Buffer;
    const b64 = data?.b64_json;
    if (typeof b64 === 'string' && b64) {
      bytes = Buffer.from(b64, 'base64');
    } else {
      const url = data?.url;
      if (typeof url !== 'string' || !url) {
        throw new ImageGenError('image_gen_failed');
      }
      bytes = await this.getBytes(url);
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_GENERATED_BYTES) {
      throw new ImageGenError('image_gen_failed');
    }
    const model =
      typeof json.model === 'string'
        ? json.model
        : (this.config.imageGenModel ?? '');
    return this.write(bytes, 'png', 'openai', model);
  }

  /** Write bytes under `<outputDir>/generated/` and return the path. */
  private write(
    bytes: Buffer,
    ext: string,
    provider: string,
    model: string,
  ): GeneratedImage {
    const dir = resolve(
      this.config.imageGenOutputDir ??
        this.config.toolsWorkspaceRoot ??
        process.cwd(),
      'generated',
    );
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${randomUUID()}.${ext}`);
    writeFileSync(file, bytes);
    return { path: file, provider, model, bytes: bytes.byteLength };
  }

  private async postJson(
    url: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new ImageGenError('image_gen_failed');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ImageGenError('image_gen_failed');
      }
      if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        throw new ImageGenError('image_gen_failed');
      }
      return json as Record<string, unknown>;
    } catch (err) {
      if (err instanceof ImageGenError) throw err;
      throw new ImageGenError('image_gen_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private async getBytes(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const res = await fetch(url, {
        headers: this.headers(false),
        signal: controller.signal,
      });
      if (!res.ok) throw new ImageGenError('image_gen_failed');
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof ImageGenError) throw err;
      throw new ImageGenError('image_gen_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['content-type'] = 'application/json';
    const key = this.resolveApiKey();
    if (key) headers['authorization'] = `Bearer ${key}`;
    return headers;
  }

  private timeoutMs(): number {
    return this.config.imageGenTimeoutMs ?? 120000;
  }

  /** Resolve a literal key or a `$VAR` / `secret:NAME` reference. */
  private resolveApiKey(): string | null {
    const raw = this.config.imageGenApiKey;
    if (!raw) return null;
    return parseSecretReference(raw) ? this.secrets.resolve(raw) : raw;
  }
}
