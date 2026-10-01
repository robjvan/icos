# Security Hardening — Auth, Secrets, and Secure Defaults

Status: **planned** (cross-cutting; not part of the M1–M21 roadmap
sequence). Owner story: ICOS is a **single-user** self-hosted tool.
The repository is public; the people who download and run ICOS are
the ones we must not endanger.

## Threat model

- **Single trusted operator.** No multi-tenancy, no per-user data
  isolation beyond what already exists. Auth exists to keep everyone
  who is not the operator out, not to model many users.
- **The internet is hostile.** The operator may expose ICOS on a LAN
  or over WAN for personal access. Anyone who reaches the port is an
  attacker by default.
- **We ship defaults to strangers.** A person who clones the repo and
  runs it must be safe *without reading this document*. Secure
  defaults are the primary deliverable; features are secondary.
- **Third-party code is untrusted.** MCP servers (spawned stdio
  processes and remote HTTP endpoints) are arbitrary code/infra the
  operator points ICOS at. ICOS must not hand them more than they
  were granted (started in M13 hardening: child env is an allowlist),
  and must not let a stranger add such a server to someone's instance.

### Assets

- Provider API keys (LLM, memory, MCP).
- The conversation/memory databases (private thoughts).
- The host itself (a spawned or remote server is a code-exec / SSRF
  vector).

## Non-negotiable invariants

1. **No secret value ever leaves core.** No API response, log line,
   ledger row, transcript, health payload, or error body carries a
   secret value. Reads expose presence + metadata only.
2. **Secret endpoints are write-only.**
3. **No secrets in URLs or query strings** (they leak into history,
   proxy logs, referrers).
4. **Fail closed.** Unreadable vault without a key, missing referenced
   var, unknown credential → refuse, loudly, never fall back to a
   weaker mode.
5. **Reference-not-value.** Catalogs store references
   (`$VAR` / `secret:NAME`); only the store holds values.
6. **Least privilege for spawned servers** (allowlist env; extend the
   same idea to filesystem/networking later if a need appears).

## Slices

### [x] S1 — Secure defaults + exposure docs (no new subsystem)

Evidence: `.reference/plans/evidence/security-s1-evidence-defaults.md`.

- [x] Bind to loopback (`127.0.0.1`) by default; binding to any other
      interface is explicit opt-in.
- [x] Loud startup warning when bound off-loopback without auth and
      without a TLS-terminating proxy configured.
- [x] CORS: stop defaulting to `*`; explicit allowed origins, and
      never `*` together with credentials. Realtime origins likewise.
- [x] `docs/` security page: how to expose safely (TLS via
      Caddy/traefik/nginx, WAN via tunnel/VPN, required env), what is
      protected and what is not, and the "do not expose without auth"
      rule. README links it.
- [x] Docker compose defaults aligned (no accidental `0.0.0.0` publish
      without a note).

### [x] S2 — API authentication + authorization (single-user)

Evidence: `.reference/plans/evidence/security-s2-evidence-auth.md`.
(Login **screen** lands with the web-client step; the API is complete
and scriptable.)

- [x] First-run **bootstrap credential** (generated once, written 0600
      into the data dir; token, not a hashed password — it is the login
      credential and must be owner-recoverable).
- [x] Session login: `httpOnly`, `Secure`, `SameSite=Strict` cookie;
      CSRF double-submit on mutating routes; login rate-limited.
- [x] **Roles**: `admin` vs `user` (one identity may hold both; the
      split exists — `admin` enforced on catalog mutation, default
      `user`).
- [x] A guard applied by default (deny-by-default) with an explicit
      allowlist for unauthenticated routes (auth endpoints + liveness).
- [x] Audit log of admin mutations and secret changes (actor, action,
      target, time, ip — never values).
- [x] Document the TLS requirement (Secure cookies need HTTPS; a
      documented loopback/LAN dev exception via `AUTH_COOKIE_SECURE`).

### [x] S3 — SecretStore + encrypted file vault

Evidence: `.reference/plans/evidence/security-s3-evidence-vault.md`.

- [x] `SecretStore` boundary: `put` / `get` / `delete` / `list`
      (metadata only) / `has`. Values resolved on demand at
      spawn/request time.
- [x] Adapters: `EnvSecretStore` (status quo, read-only) and
      `FileVaultSecretStore` (default for UI-managed secrets):
      AES-256-GCM, per-secret random nonce, secret name bound as AAD,
      versioned entries, file `0600` in the data dir.
- [x] Master key from `VAULT_KEY_FILE` (preferred) or `VAULT_KEY` env;
      empty vault + no key = UI-managed secrets disabled (fail closed);
      non-empty vault + no key = boot fails loudly. Key backup
      documented (vault is useless without it).
- [x] Write-only secret endpoints (`PUT/DELETE`), presence-only reads,
      `Cache-Control: no-store`, redaction in every error path.
- [x] Rotation: re-enter a secret; vault master-key rotation
      (re-encrypt) — `rotateMasterKey` primitive + test (CLI wrapper is
      a small follow-up).
- [x] Deleting a referenced secret fails the dependent server/provider
      loudly — never a cached value (live-verified).

### [ ] S4 — Provider registry (LLM providers as data)

- [ ] `providers.json` catalog mirroring the MCP catalog: entries
      `{ id, baseUrl, model, apiKeyRef, headers?, enabled? }`,
      validated at boot, explicit reload endpoint, no-restart diffing.
- [ ] `apiKeyRef` resolves through `SecretStore` (or `$VAR`); the
      active provider is selectable. Provider-agnostic rule unchanged.
- [ ] Migrate `LLM_API_KEY` / `MEMORY_LLM_API_KEY` to references; per
      provider "test connection" that uses the value without storing it
      in a readable form.
- [ ] Health surface reports provider state (configured/reachable),
      never the key.

### [ ] S5 — Frontend management (web-client, in scope for this milestone)

- [ ] Server/provider management UI: add/edit/enable/disable/remove;
      catalog + provider refresh without restart.
- [ ] Secret entry fields are write-only and masked; show presence +
      last-updated + last-4/fingerprint only.
- [ ] Login/logout, session expiry handling, admin-only sections.
- [ ] Clear "you are exposing this instance" warnings for non-loopback.

### [ ] S6 — Verification

- [ ] Unit + e2e for guards (deny-by-default, role split), vault
      (round-trip, AAD binding, tamper detection, missing-key fail
      closed), reference resolution + integrity.
- [ ] Live: TLS-terminated deployment, login, add a provider + an MCP
      server from the UI, secret never retrievable, rotate a key,
      restart and confirm persistence.
- [ ] Adversarial checks: request a secret over every read path;
      confirm absence in logs/health/ledger; confirm unauthenticated
      mutation is rejected; confirm spawned-server env still scoped.
- [ ] Secret-at-rest inspection: vault file is ciphertext; no plaintext
      on disk.

## Explicitly out of scope

- Multi-user accounts / tenancy / sharing.
- OAuth/OIDC/SAML (a reverse-proxy identity is acceptable upstream).
- External secret managers (Vault/Infisical/cloud KMS) — a future
  adapter behind `SecretStore`.
- Changing the provider-agnostic / OpenAI-compatible boundary.

## Definition of Done

A stranger can `git clone`, follow the README, and be safe by default;
the operator can add providers and MCP servers from the frontend,
entering keys over TLS, with the keys never retrievable, never logged,
never on disk in plaintext, and never handed to spawned servers beyond
what each was granted — while loopback-only use stays as simple as it
is today.
