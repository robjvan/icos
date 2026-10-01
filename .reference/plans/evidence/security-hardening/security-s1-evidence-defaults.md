# Security S1 Evidence — Secure Defaults + Exposure Docs

**Date:** 2026-10-01. **Scope:** loopback-by-default binding, loud
off-loopback warning, explicit-origin CORS/realtime (no wildcard),
security docs, compose defaults. No authentication yet (S2).

## What landed

- **Loopback by default.** New `HOST` (default `127.0.0.1`);
  `main.ts` binds it. Bare-metal/local starts unreachable from the
  network until the operator sets `HOST`.
- **Loud exposure warning** (`security/security-posture.ts`, pure +
  unit-tested): loopback is quiet; anything reachable beyond the
  machine warns that ICOS has no authentication yet and anyone who can
  reach the port can read conversations / spend credits, points at the
  container port-mapping boundary when applicable, and tells the
  operator to front it with TLS + auth or rebind. `EXPOSE_ACKNOWLEDGED`
  (default false) silences it only after the operator asserts
  protection; it changes no behavior.
- **No wildcard origins.** `CORS_ALLOWED_ORIGINS` (default the bundled
  loopback web client) and `REALTIME_ALLOWED_ORIGINS` (falls back to
  the CORS list) accept only bare `scheme://host[:port]` origins; `*`
  is refused at load with an actionable error, as are paths/trailing
  slashes. CORS is enabled with `credentials: true` and the explicit
  list (the socket already enforced origins server-side; its old `*`
  default also let Origin-less clients through — now rejected).
- **Docs** (`docs/security.md`): boundaries table, settings, a Caddy
  TLS+auth example, the secrets posture, and a pre-exposure checklist.
  README gains a Security callout in Getting Started + a docs link.
- **Compose defaults**: core `ports: 127.0.0.1:3000:3000`, web-client
  `127.0.0.1:4200:4200`, with `HOST: 0.0.0.0` set inside the container
  (the boundary is the loopback publish). DMR override untouched (it
  sets no ports).

## Verification

- **798 unit green** (9 new: `isLoopbackHost`, container detection, the
  four posture cases, config defaults + wildcard/bad-origin refusal).
  **48 e2e green.** `tsc`/`eslint` clean.
- **Live (three boots)**:
  - defaults → log `Listening on 127.0.0.1:3101` + loopback info;
    `Origin: http://localhost:4200` returns
    `Access-Control-Allow-Origin: http://localhost:4200`, while
    `Origin: http://evil.example` returns **no** ACAO header.
  - `HOST=0.0.0.0` → the three warning lines fire (`EXPOSED …`, no
    authentication, TLS/rebind guidance).
  - `CORS_ALLOWED_ORIGINS=*` → boot fails with
    `must list explicit origins; "*" is not allowed`.

## Notes / follow-ups

- Authentication is S2; until it lands, the off-loopback warning is
  accurate and expected.
- The bundled web client is cross-origin (`:4200` → `:3000`) and stays
  in the default allowlist; a real hostname origin must be added
  explicitly.
- S3–S5 (vault, provider registry, frontend management) build on S2.
