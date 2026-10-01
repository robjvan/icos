/**
 * Auth request helpers (S2). The session is an httpOnly cookie, so
 * every API call must opt into credentials. State-changing requests
 * echo the readable `icos_csrf` cookie in the `x-icos-csrf` header
 * (double-submit) — the server rejects mutations without it.
 */

export const CSRF_COOKIE = 'icos_csrf';
export const CSRF_HEADER = 'x-icos-csrf';

/** Read the CSRF cookie value, or null when absent. */
export function csrfToken(): string | null {
  const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`).exec(
    document.cookie,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** Headers for a mutating JSON request (content type + CSRF echo). */
export function mutationHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = csrfToken();
  if (token) headers[CSRF_HEADER] = token;
  return headers;
}
