import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';

/** An uploaded file as it survives storage (metadata only). */
export interface StoredAttachment {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** API reference the client (and, later, the agent) can resolve. */
  url: string;
  createdAt: string;
}

export interface AttachmentFile {
  meta: StoredAttachment;
  path: string;
}

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;

/**
 * M16.2 attachment storage. Files live under the configured data directory
 * (`~/.icos/data/attachments` by default), written owner-only (`0600`) in a
 * `0700` directory, with a small JSON sidecar for metadata. Names are
 * sanitized and ids are validated, so a request can never escape the store
 * directory.
 */
@Injectable()
export class AttachmentStore {
  private readonly logger = new Logger(AttachmentStore.name);

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  private get dir(): string {
    return (
      this.config.attachmentsDirPath ??
      join(homedir(), '.icos', 'data', 'attachments')
    );
  }

  save(input: {
    originalName: string;
    contentType: string;
    buffer: Buffer;
  }): StoredAttachment {
    const id = randomUUID();
    const name = safeName(input.originalName);
    const ext = safeExtension(name);
    const meta: StoredAttachment = {
      id,
      name,
      contentType: input.contentType,
      sizeBytes: input.buffer.length,
      url: `/core/attachments/${id}`,
      createdAt: new Date().toISOString(),
    };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(this.dir, `${id}${ext}`), input.buffer, { mode: 0o600 });
    writeFileSync(join(this.dir, `${id}.meta.json`), JSON.stringify(meta), {
      mode: 0o600,
    });
    return meta;
  }

  get(id: string): AttachmentFile | null {
    if (!ID_PATTERN.test(id)) return null;
    const metaPath = join(this.dir, `${id}.meta.json`);
    if (!existsSync(metaPath)) return null;
    let meta: StoredAttachment;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as StoredAttachment;
    } catch {
      return null;
    }
    const filePath = join(this.dir, `${id}${safeExtension(meta.name)}`);
    if (!existsSync(filePath)) return null;
    // The file on disk is the source of truth for size.
    try {
      meta.sizeBytes = statSync(filePath).size;
    } catch {
      // Keep the recorded size; the file exists (checked above).
    }
    return { meta, path: filePath };
  }
}

/** Keep only the final path segment, strip control characters, bound length. */
function safeName(raw: string): string {
  const normalized = (raw ?? '').replace(/\\/g, '/');
  const last =
    normalized
      .split('/')
      .filter((segment) => segment !== '')
      .pop() ?? '';
  let clean = '';
  for (const ch of last) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) clean += ch;
  }
  clean = clean.trim();
  if (clean === '' || clean === '.' || clean === '..') return 'file';
  return clean.length > MAX_NAME_LENGTH
    ? clean.slice(0, MAX_NAME_LENGTH)
    : clean;
}

/** Only a simple, safe extension is preserved (never used for typing). */
function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = name.slice(dot);
  return /^\.[A-Za-z0-9]{1,12}$/.test(ext) ? ext.toLowerCase() : '';
}
