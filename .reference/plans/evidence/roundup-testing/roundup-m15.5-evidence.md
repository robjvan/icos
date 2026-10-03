# Roundup Testing — Verified Reality at M15.5

> **Date:** 2026-10-03. **Scope:** M1–M15.5, the security-hardening pass, the
> web client, and the compose launch path. **Origin:**
> `.reference/roundup-testing/idea.md`. **Plan:**
> `.reference/plans/closed/roundup-testing-m15.5.md`.
>
> This is a verification pass, not a feature. It re-checks what the
> repository claims about itself against the running system and fixes the
> gaps it finds.

## Verdict

The platform is substantially what it says it is. The runtime builds and
boots healthy in Docker, every route is mounted, the live authenticated
surfaces work, and the security posture matches its documentation. The
findings were **documentation drift** (the README/status lagged M14–M15.5),
one **test determinism** bug in the web client, and one **portability** wart
in the committed compose file. All are fixed; the two remaining items are a
rare environment-only e2e flake and four routes that lack an HTTP-level
regression test (their behaviour is unit-tested and was live-probed).

## R1 — Baseline

Environment: Node **24.21.0**, npm **11.19.0**, Docker **29.8.0**, Compose
**v5.5.1**. Branch `dev`.

| Gate | Result |
| --- | --- |
| `tsc --noEmit` (core) | clean |
| `eslint {src,test}` (core) | clean |
| `npm test` (core unit) | **994 passed**, 1 skipped (opt-in live spec) |
| `jest --config test/jest-e2e.json` (core e2e) | **65 passed** |
| `ng test --watch=false` (web client) | **185 passed / 48 files**, exit 0 (after the R4 fix) |
| `npm run lint` (web client) | clean |
| `docker compose build core web-client` | both images built |
| `docker compose up -d` | **core healthy** (`127.0.0.1:3000`), **web-client healthy** (`127.0.0.1:4200`) |

Boot invariants held: fail-closed persona core loaded (11 entries from
`~/.icos/persona/core.md`), auth on with a bootstrap token, security warnings
for the containerised `0.0.0.0` bind, MCP/skills catalogs loaded, realtime
gateway up. The optional local Jev verifier answered `/healthz` 200.

**Live authenticated probes** (admin login via the bootstrap token; cookie +
`x-icos-csrf`): `/core/auth/session` → `authenticated:true, role:admin`;
`/core/health` healthy; `/core/providers`; `/core/persona/core` (loaded, 11
entries); `/core/persona/drift`; `/core/claims` (real rows); `/core/hallucination/mitigations`;
`/core/mcp/servers`; `/core/skills`; `/core/security/status`; `/core/recall/trace`
(400 with the correct `sessionId must be a UUID` validation). Security claims
verified live: an unknown CORS origin gets **no** `access-control-allow-origin`,
the allowed origin is echoed, and `/core/secrets` returns metadata only with
`Cache-Control: no-store`.

## R2 — Ability register

The boot log maps **72 HTTP routes** across 21 controllers. Cross-referencing
every route against the committed specs (unit + e2e):

- **68 / 72** routes are referenced by at least one spec.
- **4** routes have no HTTP-level regression test but their behaviour is
  unit-tested **and** was live-probed here:

  | Route | Live result | Underlying proof |
  | --- | --- | --- |
  | `GET /core/persona/grounding` | 200, real grounding result | `persona-grounding.service.spec.ts` |
  | `POST /core/persona/drift/audit` | 200, findings | `persona-drift.service.spec.ts` |
  | `POST /core/persona/seeds/import` | 400, clear validation | `persona-seed-import.service` (M14c evidence) |
  | `POST /core/conversation/resume-stream` | 400, clear validation | conversation-service unit tests |

The web client exposes the documented MCP / Models / Server-settings tabs plus
the M14 `identity-tab` (persona review) and memory-review surfaces.

## R3 — Claim register

| Claim (source) | Verdict |
| --- | --- |
| "M1–M13 are complete" and the capability list omitting persona/drift/hallucination (`README.md`) | **stale → fixed** |
| Node 24.13.0 / npm 11.6.2 (`README.md` badges, `USAGE.md`) | **stale → fixed** (24.x / 11.x, tested 24.21.0 / 11.19.0) |
| `git clone …/robjvan/icos.git; cd icos` (`USAGE.md`) | **wrong → fixed** (remote is `icos-v3.git`) |
| M15.5 listed as "Designed", not done (`.reference/status.md`) | **stale → fixed** |
| Loopback default, auth on, only `/core/auth/*` + `/core/health/live` public, exact CORS, `Secure` cookie, `x-icos-csrf` (`docs/security.md`) | **verified** (live + config) |
| Vault AES-256-GCM, admin-only write-only, `no-store` (`docs/security.md`) | **verified** (live + `file-vault.ts`) |
| Data root paths under `~/.icos` (`USAGE.md`) | **verified** (config defaults match) |
| INDEX repo map (files/paths) | **verified** (all present) |
| Tool/skill blueprint file references | **verified** (all present) |
| Claims-verifier wiring, `host.docker.internal:8765`, HF weight cache (`docs/model-lineups.md`) | **verified** (matches `bin/verifier`, `.env.sample`) |

## R4 — Fixes

1. **`web-client` tests were not hermetic (code fix).** `DashboardPage` starts
   the real `RealtimeService`, which opened `ws://localhost:3000/core/events`.
   With a Core running, undici's connection callback threw a cross-realm
   `Event` `TypeError` — all 185 tests passed but the run exited **1**; with
   Core down it exited 0. Added `src/test-setup.ts` (a no-op `WebSocket`) and
   wired it via `angular.json` `setupFiles`. The suite now exits 0 whether or
   not a Core is running.
2. **`docker-compose.yml` hardcoded `/Users/rob/.icos` (portability fix).**
   Changed to `${HOME}/.icos:${HOME}/.icos` — identical on this host, correct
   for anyone else cloning the public repo.
3. **`README.md`** — "M1–M15.5 complete"; added persona, drift, and
   hallucination-mitigation capability bullets; updated the Updated/Node/npm
   badges.
4. **`USAGE.md`** — version requirement softened to 24.x / 11.x (tested
   versions noted); corrected the clone URL to `icos-v3.git` / `cd icos-v3`.
5. **`.reference/status.md`** — M15.5 moved from "Designed" to Implemented;
   date bumped.

## R5 — Remaining (honest, not fixed)

- **Rare core-e2e 407 flake (environment).** Under parallel execution the
  core e2e suite very occasionally received a spurious
  `407 Proxy Authentication Required` on a loopback request (~3 times early
  in the session, then **57 consecutive clean runs**, and 6/6 clean with
  `--runInBand`). No code path in ICOS returns 407, superagent has no HTTP
  proxy support, no proxy env is set, and OS proxy config is empty — so this
  is a transparent local proxy/security agent, not an ICOS defect. Recorded
  rather than "fixed".
- **Four routes without HTTP regression tests** (R2): behaviour is
  unit-tested and live-probed, but no automated route test exists. A small
  follow-up could add e2e coverage for them.
- **DMR path** (`docker-compose-dmr.yml`, "in testing") was **not** exercised
  — it needs the Docker Model Runner and multi-GB model downloads.
- **VRAM/hardware lineups** (`docs/model-lineups.md`) are design guidance and
  were not benchmarked here.

## Reproduce

```sh
cd core && npx tsc --noEmit && npx eslint "{src,test}/**/*.ts"
cd core && npm test && npx jest --config test/jest-e2e.json
cd web-client && npx ng test --watch=false && npm run lint
docker compose build && docker compose up -d && docker compose ps
```
