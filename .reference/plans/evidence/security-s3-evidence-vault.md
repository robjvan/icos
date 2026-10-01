# Security S3 (part 1) Evidence — SecretStore + Encrypted Vault

**Date:** 2026-10-01. **Scope:** the `SecretStore` boundary, the
encrypted file vault, reference parsing/resolution, and the write-only
secret API. Consumer wiring (MCP `secret:` references) is part 2.

## What landed

- **Boundary** (`secrets/secret-store.ts`): `SecretStore` with
  `has/get/put/delete/list` + `writable`. `EnvSecretStore` (read-only
  over the process env; `list()` returns nothing so env names never
  leak). `DisabledSecretStore` for the no-master-key case (reads miss,
  writes refuse with an actionable reason).
- **Vault** (`secrets/file-vault.ts`): `FileVaultSecretStore` —
  AES-256-GCM, random 12-byte nonce per secret, **secret name bound as
  AAD** (entries cannot be swapped), versioned JSON file written
  atomically (`tmp` + rename) at **0600**. `get` returns null on
  tamper/wrong-key (fail closed). `put` validates the name and refuses
  empty values; `list` is metadata only. Master-key handling:
  `parseMasterKey` (hex/base64/base64url/raw 32 bytes; rejects anything
  else) and `loadMasterKey` (file preferred, else inline; a malformed
  configured key throws).
- **References + resolver** (`secrets/reference.ts`,
  `secrets/secret-resolver.ts`): `$VAR`/`${VAR}` → env, `secret:NAME` →
  vault; anything else is a literal and rejected. `SecretResolver`
  resolves **on demand** (no caching), so rotation is immediate and a
  deleted value fails closed. Names are `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`.
- **Wiring** (`secrets/secrets.module.ts`): `createVaultStore` — no key
  + empty vault ⇒ `DisabledSecretStore`; no key + **non-empty** vault ⇒
  throw (boot fails loudly, never silently ignore stored secrets); key
  ⇒ writable vault. Registered in `CoreModule`.
- **API** (`secrets/secrets.controller.ts`): `GET /core/secrets`
  (metadata + `writable`), `GET /core/secrets/:name` (presence +
  metadata), `PUT /core/secrets/:name` (create/rotate), `DELETE
  /core/secrets/:name`. **Admin-only** (`@RequireRole('admin')`),
  `Cache-Control: no-store` on every response, write-only (no value is
  ever echoed), invalid names → 400, disabled vault → 409, unknown →
  404.
- **Config/docs**: `VAULT_PATH` (default `<AUTH_DIR_PATH>/secrets.vault`
  so it follows the Docker mount), `VAULT_KEY_FILE`, `VAULT_KEY` (the
  plan's `ICOS_VAULT_KEY*` names are accepted too); `.env.sample` and
  `docs/security.md` updated.

## Verification

- **837 unit** (20 new: reference parsing, master-key parsing, vault
  round-trip/persistence/0600, **AAD swap rejection**, tamper/wrong-key
  fail-closed, version/JSON errors, `vaultHasEntries`, env/disabled
  stores, `createVaultStore` (disabled / loud / writable), resolver
  on-demand + rotation + deletion) **+ 55 e2e** (3 new: write-only +
  no-value-leak + delete → 404; CSRF/name/empty validation; disabled
  vault lists `writable:false` and refuses writes with 409).
  `tsc`/`eslint` clean.
- Live verification is combined with part 2 (once MCP can reference a
  vault secret end to end).

## Notes

- AES-256-GCM via Node `crypto` (no new dependency).
- The vault file format is versioned; a version mismatch fails boot.
- Vault at rest is only as safe as the master key: the key must be
  backed up out of band (documented), and it is never written to the
  vault file or logged.
- **Per-secret rotation** is a `PUT`. **Master-key rotation** is a
  `rotateMasterKey(path, oldKey, newKey)` primitive (re-encrypts every
  entry; wrong old key fails loudly) — unit-tested; a CLI wrapper for
  operators is a small follow-up.

## Part 2 — consumer wiring + dependency failure

- **References**: MCP catalog `env`/`headers` now accept `secret:NAME`
  (vault) in addition to `$VAR` (env). Validation rejects literals;
  resolution happens at spawn/request time via `SecretResolver`.
- **Spawn-time resolution**: `resolveServerEnv`/`buildChildEnv` take a
  lookup function; `SdkMcpClient` resolves stdio env and HTTP headers
  through the resolver. `SdkMcpClientFactory` injects `SecretResolver`.
- **Change notification**: a small `SecretChangeNotifier` decouples the
  secrets layer from consumers. `McpConnectionService` subscribes and
  reconnects only the servers whose entry references the changed vault
  value (`reconnectReferencing`), so a rotated value is re-resolved and
  a deleted one fails closed — never a cached value.
- **Determinism fix**: the M13d catalog-watch test was OS-poll-timing
  dependent and flaked under the full parallel suite; it now stubs
  `fs.watchFile` and drives the callback directly (deterministic).

### Part 2 verification

- **844 unit** (part 2 adds: vault-reference resolution, literal
  rejection, `secret:` in child env, `SecretChangeNotifier`, and MCP
  `reconnectReferencing` + notifier-driven reconnect) **+ 55 e2e**;
  full suite green across repeated runs; `tsc`/`eslint` clean.
- **Live (scratch core :3103, real `server-everything` over stdio)**:
  with the secret absent, the server **failed closed** —
  `env "DEMO_SECRET" (secret:demo) is not set` and the child never
  spawned (`child-env.txt` absent). `PUT /core/secrets/demo` →
  notifier-driven reconnect → **connected (13 tools)** with
  `DEMO_SECRET=TOP-SECRET-123` in the spawned child env. Rotating to
  `ROTATED-456` produced a **fresh child with the new value** (not the
  old). `DELETE` → **failed closed** with the same clear reason. The
  vault file is `0600` and contains **no plaintext**; the secret
  **values never appear in the logs**; the API returned metadata only.
