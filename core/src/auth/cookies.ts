/**
 * Session and CSRF cookie handling (S2), pure and testable.
 *
 * The session cookie is HMAC-signed and httpOnly; the CSRF cookie is
 * deliberately readable by the page so the client can echo it in a
 * header (double-submit). Both are SameSite=Strict, which is the
 * primary CSRF defence — the header check is defence in depth.
 */

export const SESSION_COOKIE = 'icos_session';
export const CSRF_COOKIE = 'icos_csrf';
export const CSRF_HEADER = 'x-icos-csrf';

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  secure: boolean;
  path: string;
  maxAge?: number;
}

/** Serialize one Set-Cookie value. Values are base64url (no escaping). */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  const parts = [`${name}=${value}`, `Path=${options.path}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  }
  parts.push(`SameSite=${options.sameSite}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Clear a cookie (expire it immediately). */
export function expireCookie(name: string, path = '/'): string {
  return `${name}=; Path=${path}; Max-Age=0; SameSite=Strict; HttpOnly`;
}

/** Parse a `Cookie` request header into a name→value map. */
export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof header !== 'string' || header.trim() === '') return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name === '') continue;
    out[name] = value;
  }
  return out;
}
