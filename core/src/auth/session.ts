import { createHmac, timingSafeEqual } from 'node:crypto';

/** Authentication role (S2). One identity may hold `admin` (the owner). */
export type AuthRole = 'admin' | 'user';

export interface SessionPayload {
  sub: string;
  role: AuthRole;
  /** Issued-at (ms). */
  iat: number;
  /** Expiry (ms). */
  exp: number;
}

/** Constant-time string comparison (length-safe first). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sign(secret: Buffer, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Build a signed session token: `base64url(payload).signature`. */
export function createSession(
  secret: Buffer,
  role: AuthRole,
  ttlMs: number,
  now: number = Date.now(),
): { value: string; payload: SessionPayload } {
  const payload: SessionPayload = {
    sub: 'admin',
    role,
    iat: now,
    exp: now + ttlMs,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { value: `${data}.${sign(secret, data)}`, payload };
}

/**
 * Verify a session token: signature (constant-time) then expiry. Any
 * malformed input returns null — never throws.
 */
export function verifySession(
  secret: Buffer,
  token: string | undefined,
  now: number = Date.now(),
): SessionPayload | null {
  if (typeof token !== 'string' || token === '') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!safeEqual(provided, sign(secret, data))) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate['exp'] !== 'number' ||
    candidate['exp'] <= now ||
    (candidate['role'] !== 'admin' && candidate['role'] !== 'user') ||
    typeof candidate['sub'] !== 'string'
  ) {
    return null;
  }
  return candidate as unknown as SessionPayload;
}
