import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { isValidSecretName } from './reference';
import type { SecretMetadata, SecretStore } from './secret-store';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const VAULT_VERSION = 1;

interface VaultEntry {
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultFile {
  version: number;
  entries: Record<string, VaultEntry>;
}

/** A fresh 32-byte master key, base64 (for ops tooling + tests). */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/**
 * Parse a 32-byte master key from hex, base64/base64url, or 32 raw
 * bytes. Returns null when the input is not exactly 32 bytes long.
 */
export function parseMasterKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (value === '') return null;
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    candidates.push(Buffer.from(value, 'hex'));
  }
  candidates.push(
    Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  );
  const utf8 = Buffer.from(value, 'utf8');
  if (utf8.length === KEY_BYTES) candidates.push(utf8);
  return candidates.find((buffer) => buffer.length === KEY_BYTES) ?? null;
}

/**
 * Resolve the master key from a file (preferred) or an inline value.
 * A configured-but-malformed key throws — the vault must never fall
 * back to a weaker mode.
 */
export function loadMasterKey(options: {
  keyFile?: string;
  key?: string;
  readFile?: (path: string) => string;
}): Buffer | null {
  const read =
    options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  if (options.keyFile) {
    const parsed = parseMasterKey(read(options.keyFile));
    if (!parsed) {
      throw new Error(
        `vault key file "${options.keyFile}" is not a 32-byte key (hex/base64)`,
      );
    }
    return parsed;
  }
  if (options.key) {
    const parsed = parseMasterKey(options.key);
    if (!parsed) {
      throw new Error('VAULT_KEY is not a 32-byte key (hex/base64)');
    }
    return parsed;
  }
  return null;
}

/** True when the vault file exists and holds at least one entry. */
export function vaultHasEntries(
  path: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): boolean {
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFile(path)) as VaultFile;
    return Object.keys(parsed.entries ?? {}).length > 0;
  } catch {
    // Present but unreadable counts as "has content": fail closed, don't
    // silently treat a corrupt vault as empty and overwrite it.
    return true;
  }
}

/**
 * Encrypted-at-rest secret vault (S3). AES-256-GCM, a random nonce per
 * secret, the secret name bound as associated data (so entries cannot
 * be swapped), and a versioned file written atomically at 0600. Values
 * are decrypted in memory on demand; `list()` yields metadata only.
 */
export class FileVaultSecretStore implements SecretStore {
  readonly writable = true;
  private entries: Record<string, VaultEntry> = {};

  constructor(
    private readonly path: string,
    private readonly key: Buffer,
  ) {
    this.entries = this.load();
  }

  has(name: string): boolean {
    return this.entries[name] !== undefined;
  }

  get(name: string): string | null {
    const entry = this.entries[name];
    if (!entry) return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(name, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Tampered, wrong key, or corrupt entry: behave as missing so the
      // dependent fails closed rather than running on bad material.
      return null;
    }
  }

  put(name: string, value: string): SecretMetadata {
    if (!isValidSecretName(name)) {
      throw new Error(`invalid secret name "${name}"`);
    }
    if (value === '') throw new Error('secret value must not be empty');
    const now = new Date().toISOString();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const existing = this.entries[name];
    this.entries[name] = {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.save();
    return this.metadata(name);
  }

  delete(name: string): boolean {
    if (!this.has(name)) return false;
    delete this.entries[name];
    this.save();
    return true;
  }

  list(): SecretMetadata[] {
    return Object.keys(this.entries)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => this.metadata(name));
  }

  private metadata(name: string): SecretMetadata {
    const entry = this.entries[name];
    return {
      name,
      createdAt: entry?.createdAt ?? '',
      updatedAt: entry?.updatedAt ?? '',
    };
  }

  private load(): Record<string, VaultEntry> {
    if (!existsSync(this.path)) return {};
    let parsed: VaultFile;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8')) as VaultFile;
    } catch {
      throw new Error(`secret vault at ${this.path} is not valid JSON`);
    }
    if (parsed.version !== VAULT_VERSION) {
      throw new Error(
        `secret vault at ${this.path} has unsupported version ${String(parsed.version)}`,
      );
    }
    return parsed.entries ?? {};
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const file: VaultFile = {
      version: VAULT_VERSION,
      entries: this.entries,
    };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(file)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Mode already applied on create; best effort otherwise.
    }
  }
}
