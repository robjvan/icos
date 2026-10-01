import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

const TOKEN_BYTES = 32;
const SESSION_KEY_BYTES = 32;

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Read a secret file, creating it (0600) with `bytes` of randomness
 * when absent or empty. Returns whether it was just created so the
 * caller can tell the operator exactly once.
 */
function readOrCreate(
  path: string,
  bytes: number,
): { value: string; created: boolean } {
  ensureDir(dirname(path));
  if (existsSync(path)) {
    const value = readFileSync(path, 'utf8').trim();
    if (value) return { value, created: false };
  }
  const value = randomBytes(bytes).toString('base64url');
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort (e.g. exotic filesystems); the mode already applied on create.
  }
  return { value, created: true };
}

/** The bootstrap login token (owner-readable file, never logged). */
export function ensureBootstrapToken(path: string): {
  value: string;
  created: boolean;
} {
  return readOrCreate(path, TOKEN_BYTES);
}

/** The HMAC key used to sign session cookies. */
export function ensureSessionKey(path: string): {
  value: string;
  created: boolean;
} {
  return readOrCreate(path, SESSION_KEY_BYTES);
}
