import { readFileSync, statSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { AttachmentStore } from '../attachments/attachment.store';
import { VisionService } from '../vision/vision.service';
import type { LlmContentPart } from '../llm/llm.client';
import type { TurnAttachment } from './attachments';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_VISION_PROMPT =
  'Describe this image in detail, including any text, objects, people, and context.';
const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
const ALLOWED_IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXT));
const ATTACHMENT_URL = /^\/core\/attachments\/([0-9a-fA-F-]{36})$/;

export interface ResolvedTurnImages {
  /** Inline image parts for a vision-capable conversation model. */
  parts: LlmContentPart[];
  /** Fallback text: descriptions produced by the vision role. */
  description: string | null;
}

/**
 * M16.2d attachment vision. Resolves image attachments to either inline
 * `image_url` content parts (when the conversation model accepts images,
 * `LLM_VISION_ENABLED`) or a text description produced by the auxiliary
 * vision role. Bounded and fail-soft: a bad/oversized/unreachable image
 * is skipped, never fails the turn. Only image MIME types are inlined.
 */
@Injectable()
export class AttachmentImageResolver {
  private readonly logger = new Logger(AttachmentImageResolver.name);

  constructor(
    private readonly store: AttachmentStore,
    private readonly vision: VisionService,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  async resolve(
    attachments?: readonly TurnAttachment[],
  ): Promise<ResolvedTurnImages> {
    const images = (attachments ?? []).filter(isImage).slice(0, MAX_IMAGES);
    if (images.length === 0) return { parts: [], description: null };
    const encoded: { mime: string; dataUrl: string }[] = [];
    for (const attachment of images) {
      const read = await this.readImage(attachment);
      if (read) encoded.push(read);
    }
    if (encoded.length === 0) return { parts: [], description: null };
    if (this.config.llmVisionEnabled !== false) {
      return {
        parts: encoded.map((image) => ({
          type: 'image_url',
          image_url: { url: image.dataUrl },
        })),
        description: null,
      };
    }
    const lines: string[] = [];
    for (const image of encoded) {
      try {
        const { text } = await this.vision.analyze({
          dataUrl: image.dataUrl,
          prompt: DEFAULT_VISION_PROMPT,
        });
        if (text.trim()) lines.push(`- ${text.trim()}`);
      } catch (err) {
        this.logger.warn(
          `Attachment vision failed: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }
    return {
      parts: [],
      description: lines.length > 0 ? lines.join('\n') : null,
    };
  }

  private async readImage(
    attachment: TurnAttachment,
  ): Promise<{ mime: string; dataUrl: string } | null> {
    const local = this.readLocal(attachment);
    if (local) return local;
    return this.fetchRemote(attachment);
  }

  /** Read a stored attachment by its `/core/attachments/<id>` reference. */
  private readLocal(
    attachment: TurnAttachment,
  ): { mime: string; dataUrl: string } | null {
    const match = ATTACHMENT_URL.exec(attachment.url.trim());
    if (!match) return null;
    const found = this.store.get(match[1]);
    if (!found) return null;
    const mime = imageMime(found.meta.contentType, found.meta.name);
    if (!mime) return null;
    try {
      if (statSync(found.path).size > MAX_IMAGE_BYTES) return null;
      const bytes = readFileSync(found.path);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }
      return { mime, dataUrl: toDataUrl(mime, bytes) };
    } catch {
      return null;
    }
  }

  /** Download an http(s) image (Discord CDN, etc.), bounded and timed. */
  private async fetchRemote(
    attachment: TurnAttachment,
  ): Promise<{ mime: string; dataUrl: string } | null> {
    let parsed: URL;
    try {
      parsed = new URL(attachment.url.trim());
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(parsed, {
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) return null;
      const mime = imageMime(
        (res.headers.get('content-type') ?? '').split(';')[0].trim(),
        attachment.name,
      );
      if (!mime) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }
      return { mime, dataUrl: toDataUrl(mime, bytes) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** True when an attachment looks like an image (content type or extension). */
function isImage(attachment: TurnAttachment): boolean {
  return imageMime(attachment.contentType ?? '', attachment.name) !== undefined;
}

/** Allowed image MIME from a declared content type, else the name extension. */
function imageMime(contentType: string, name?: string): string | undefined {
  const declared = contentType.trim().toLowerCase();
  if (ALLOWED_IMAGE_MIMES.has(declared)) return declared;
  if (!name) return undefined;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext];
}

function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
