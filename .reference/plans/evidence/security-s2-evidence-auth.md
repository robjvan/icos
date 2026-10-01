# Security S2 Evidence — API Authentication (core)

**Date:** 2026-10-01. **Scope:** single-user authentication in `core/`:
bootstrap token, signed session cookie, CSRF, deny-by-default guard,
roles mechanism, audit log, socket auth. The login **screen** is the
immediate follow-up (web-client); the API is fully scriptable today.

## What landed

- **Bootstrap token** (`auth/secrets-files.ts`): first run generates a
  random 32-byte token at `AUTH_DIR_PATH/token` (mode **0600**) and a
  separate HMAC session key at `session-key` (0600). The token is
  **never logged** — only its path.
- **Sessions** (`auth/session.ts`, `auth/cookies.ts`): `createSession`
  signs a JSON payload (`sub/role/iat/exp`) with HMAC-SHA256;
  `verifySession` checks the signature constant-time then expiry, and
  rejects malformed/unknown-role input. Cookie is `httpOnly`,
  `SameSite=Strict`, `Secure` (per `AUTH_COOKIE_SECURE`), `Path=/`,
  with the TTL as `Max-Age`. A non-httpOnly `icos_csrf` cookie pairs
  with the `x-icos-csrf` header for double-submit.
- **Deny-by-default guard** (`auth/auth.guard.ts`, registered app-wide
  via `APP_GUARD`): every route needs a valid session except `@Public()`
  ones — `POST /core/auth/login`, `POST /core/auth/logout`,
  `GET /core/auth/session`, `GET /core/health/live`. Mutating methods
  require the CSRF pair; `@RequireRole('admin')` (applied to
  `POST /core/mcp/reload`) enforces the role split. A route without a
  role default requires `user`. `AUTH_ENABLED=false` disables the gate.
- **Rate limiting + audit** (`auth/auth.service.ts`): 10 failed logins
  per IP per 15 min → throttled (today, per-IP, in-memory). Every
  security event (login success/failure/rate-limited, admin mutation)
  is appended to `AUTH_DIR_PATH/audit.log` (0600, JSONL) — actor,
  action, target, ip, outcome only; **never a value**.
- **Socket authentication** (`realtime.gateway.ts`): the `/core/events`
  socket bypasses the HTTP guard, so the handshake now also verifies
  the session cookie (and still checks Origin). Missing/invalid → close
  1008.
- **Login endpoints** (`auth/auth.controller.ts`): `POST
  /core/auth/login` `{token}` → session + CSRF cookies (400 on bad
  shape, 401 on wrong token / throttled); `GET /core/auth/session` →
  `{authenticated, role}`; `POST /core/auth/logout` → clears cookies.
- **Health split**: `GET /core/health/live` is the public liveness
  route (no host detail); `GET /core/health` is authenticated. Compose
  healthcheck repointed to `/core/health/live`.
- **Config + docs**: `AUTH_ENABLED`, `AUTH_DIR_PATH`,
  `AUTH_SESSION_TTL_MS`, `AUTH_COOKIE_SECURE` (`.env.sample`); the boot
  posture now distinguishes "auth off" from "auth on but no TLS"
  (Secure cookies need HTTPS); `docs/security.md` gains a login section
  and updated checklist.

## Verification

- **817 unit** (19 new: session round-trip/expiry/tamper/unknown-role,
  cookies serialize/parse, secret-file creation + 0600, AuthService
  login/verify/CSRF/rate-limit/audit-no-values/disabled, guard posture
  auth-on vs auth-off, config auth parsing) **+ 52 e2e** (4 new in
  `app.e2e-spec.ts`: liveness public + everything else 401; wrong/absent
  token rejected; login → session report → mutation 403 without CSRF →
  200 with it; logout clears cookies). `tsc`/`eslint` clean.
- **Live (scratch core :3102)**: token written `0600`; `/core/health/live`
  200; `/core/sessions` 401; bad login 401; good login 200 + both
  cookies; `GET /core/auth/session` → `{authenticated:true,role:"admin"}`;
  `/core/sessions` 200 with the cookie; `POST /core/mcp/reload` → **403**
  without the CSRF header, **200** with it; audit log recorded
  failure+success (no values); token value **absent from the core log**.

## Notes

- Token-at-rest is a 0600 file (the plan's "generated once, written
  0600" option); it is not hashed because it *is* the login credential
  and must be recoverable by the owner. Docker deployments store it
  under the bind-mounted data root.
- Sessions are stateless (signed cookie); revocation = rotate the
  session key. A future settings UI can expose "log out everywhere".
- The web-client is cross-origin (`:4200`→`:3000`), same-site, so the
  `SameSite=Strict` cookie is sent; the login screen must send mutating
  requests with `x-icos-csrf`. That screen is the next step.
