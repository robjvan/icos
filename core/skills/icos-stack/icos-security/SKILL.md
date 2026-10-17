---
name: icos-security
description: "The ICOS security posture: authentication, the encrypted secret vault, the provider catalog, exposure defaults, and CORS — secure by default for a single operator."
version: 1.0.0
author: ICOS
---

# ICOS Security — Auth, Secrets, and Secure Defaults

## Overview

ICOS is a **single-user, self-hosted** tool whose repository is public: the
defaults must keep a stranger who clones and runs it safe without reading the
docs. Authentication keeps everyone who is not the operator out; the vault keeps
provider keys out of every response, log, and ledger.

## Status

**Implementation:** Active. S1–S6 hardening complete.

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/auth/`, `core/src/secrets/`, `core/src/providers/`,
`core/src/security/`. **Config:** `core/.env.sample`. **Docs:** `docs/security.md`.

## Key Files

- `auth/auth.service.ts` / `auth.guard.ts` / `session.ts` / `cookies.ts` —
  bootstrap token, signed sessions, CSRF double-submit, per-IP rate limiting.
- `secrets/file-vault.ts` — AES-256-GCM encrypted vault; values are
  **write-only**.
- `secrets/reference.ts` / `secret-resolver.ts` — `secret:NAME` / `$VAR`
  references.
- `providers/provider-catalog.ts` / `provider-registry.service.ts` — runtime
  provider selection (chat / memory / verification roles) with key references.
- `security/security-posture.ts` — exposure posture and boot warnings.

## Invariants

- No secret value ever leaves core — no API response, log, ledger row,
  transcript, health payload, or error body.
- Loopback binding by default; authentication on by default.
- Exact CORS origins; `*` is refused.
- A spawned MCP server gets only the environment variables it references.

## Do Not Assume

- Exposing it is safe without TLS. Boot warns loudly; `EXPOSE_ACKNOWLEDGED` only
  silences the warning.
- Login over `127.0.0.1` works like `localhost` — Secure cookies only persist on
  `localhost` over plain HTTP.
