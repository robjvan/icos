# Security S6 Evidence — Verification (milestone close)

**Date:** 2026-10-01. **Scope:** verification of S1–S5 (binding/auth,
vault, providers, frontend) against a live instance, plus the invariant
audit. No new capability.

## Unit + e2e (guards, vault, references)

- **866 core unit + 59 e2e**, `tsc`/`eslint` clean. Covered across the
  slices: deny-by-default guard (allowlist = auth endpoints +
  `/core/health/live`), 401/403/409 error contracts, CSRF double-submit,
  login rate-limit, vault round-trip / **AAD swap rejection** / tamper /
  wrong-key / missing-key fail-closed / version and JSON errors,
  `createVaultStore` (disabled vs loud vs writable), reference parsing
  (`$VAR`/`secret:`) and integrity, provider resolution + active switch,
  catalog CRUD validation.
- **179 web-client tests**, `ng build` + `eslint` clean.

## Adversarial checks (live, scratch core :3105)

Sentinel value `S6-SECRET-SENTINEL-424242` stored under two vault names
(`openrouter`, `probe`) via the write-only API.

- **Unauthenticated access rejected**: `GET /core/providers`,
  `GET /core/secrets`, and the mutations `PUT /core/providers/x`,
  `DELETE /core/mcp/servers/x` all → **401**.
- **No secret on any read path**: swept 16 authenticated GET endpoints
  (`/core/providers`, `/core/providers/catalog`, `/core/health`,
  `/core/mcp/servers`, `/core/mcp/catalog`, `/core/secrets`,
  `/core/security/status`, `/core/sessions`, `/core/approvals`,
  `/core/auth/session`, `/core/skills`, `/core/memory-candidates`,
  `/core/claims`, `/core/promotions`, `/core/prospective`,
  `/core/clarifications`) — the sentinel appeared in **none**.
- **No secret in logs**: sentinel count in the core log = 0.
- **Spawned-server env still scoped**: a stdio probe declaring
  `DECLARED=secret:probe` and `FROM_ENV=$ICOS_S6_ENV_ONLY` spawned with
  both present; an **undeclared** process env var
  (`ICOS_S6_LEAK=LEAK-SENTINEL-777`) was **absent** from the child env.

## Secret-at-rest inspection

- `secrets.vault` mode `-rw-------` (**0600**); the sentinel appears **0**
  times in the file (ciphertext only).

## Restart persistence

Killed and restarted core with the same vault key + catalog paths:

- Provider selection persisted (`active: {conversation: local, memory:
  local}`).
- Vault secrets persisted and still decrypt (`remote hasKey=true`,
  `local hasKey=false`) — the key file reopens the vault.

## TLS-terminated deployment

Stood up a minimal HTTPS reverse proxy (`:3443` → core `:3105`) with a
self-signed cert:

- `GET /core/health/live` → 200 through TLS.
- `POST /core/auth/login` through TLS → 200 with
  `Set-Cookie: icos_session=…; SameSite=Strict; HttpOnly; Secure` and
  `icos_csrf=…; SameSite=Strict; Secure` (the CSRF cookie is readable by
  design, the session cookie is not).
- Authenticated `GET /core/providers` → 200 through TLS.

## Live browser walkthrough (web client)

Served the built SPA (`:4200`) against the live core (`:3000`):

- An unauthenticated visit redirected to **`/login`** (the route guard).
- Entering the bootstrap token and submitting reached the **dashboard**
  (the "Sign out" control appeared).
- The **MCP tab** rendered the live row — DOM verification:
  `probe · stdio · connected · 13 · Edit Remove` — i.e. the management UI
  reflects real engine state, not fixtures.
- During the provider/settings checks the browser session was
  interrupted by the operator poking the tab (external interference, not
  a defect); those screens are otherwise covered by unit tests + the
  live API checks above, and their data path (`GET /core/providers`,
  `GET /core/secrets`) was verified 200 with the same session.

## Invariant audit (summary)

1. No secret value leaves core — swept above. ✓
2. Secret endpoints are write-only — `GET` returns metadata/presence. ✓
3. No secrets in URLs — all secret I/O is a request body. ✓
4. Fail closed — missing key / missing reference / wrong key all refuse;
   a non-empty vault with no key fails boot. ✓
5. Reference-not-value — catalogs hold `$VAR`/`secret:` only. ✓
6. Least privilege for spawned servers — child env allowlist verified. ✓
