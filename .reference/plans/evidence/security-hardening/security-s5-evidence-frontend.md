# Security S5 Evidence — Frontend Management

**Date:** 2026-10-01. **Scope:** the web-client management UI over the
S3/S4 APIs, plus the core CRUD backing (committed separately as
`5e87107`). Login/logout and credential handling landed in S2.

## What landed

**Core backing** (`5e87107`): MCP `GET /core/mcp/catalog` +
`PUT/DELETE /core/mcp/servers/:name`; provider
`GET /core/providers/catalog` + `PUT/DELETE /core/providers/:id`
(removing the active provider clears the selection); admin
`GET /core/security/status`. All validate then atomically rewrite the
catalog file and reconcile without a restart; literals are rejected.

**Web client**:
- `CoreApiService` gained `put`/`delete` (credentials + CSRF echo). A
  `401` from any API call (except the login attempt) dispatches
  `icos:unauthorized`; `AuthService` listens and returns to `/login` —
  one place, no per-component handling (session-expiry handling).
- **MCP tab** (was a placeholder): server list (state/tools/reason),
  add/edit (transport, command+args or URL, `KEY=reference` env/header
  lines, approval, enabled), remove, reload. References only — values
  never appear here.
- **Models tab** (was a placeholder): provider list (model, base URL,
  key **presence**, active markers for conversation/memory), add/edit,
  remove, per-role "use for chat/memory", per-provider **Test**, reload.
- **Server settings tab** (was a read-only placeholder): the secret
  vault — list (name/updatedAt only), write/rotate (a `type="password"`
  field cleared after save), delete with a "dependents fail closed"
  confirmation; and the **exposure posture** with a red warning when
  bound beyond loopback and unacknowledged.
- **Registry** for all four surfaces: `McpAdminService`,
  `ProviderAdminService`, `SecretAdminService`, `SecurityStatusService`.

## Verification

- **179 client tests** (new/rewritten: MCP tab renders the live list +
  opens the editor; Models tab renders presence + active markers + opens
  the editor; Server settings lists secrets + shows the exposure warning
  + never renders a stored value; management services hit the right
  endpoints/methods) **+ `ng build` clean + `eslint` clean**.
- **Core**: 866 unit + 59 e2e (the S5 CRUD + status endpoints are
  covered by e2e), `tsc`/`eslint` clean.
- **Not yet done**: a live browser walkthrough of the new screens. That
  belongs to S6 (verification) with the rest of the live evidence.

## Notes

- The secret value field is only rendered when the vault is writable;
  when disabled the UI explains how to enable it and notes that `$VAR`
  references still work.
- Admin-only gating (`@RequireRole('admin')`) is applied to the mutation
  endpoints and the management reads; with one identity it is a no-op
  today, kept as the seam for future multi-user.
- The web client's API calls are cross-origin (`:4200`→`:3000`),
  same-site, so the `SameSite=Strict` cookie is sent; mutations echo the
  CSRF cookie (verified live in S2).
