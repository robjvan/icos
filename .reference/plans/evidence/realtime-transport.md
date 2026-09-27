# Realtime Transport — Evidence (core + web-client)

Date: 2026-09-27. Branch: `dev`. Scope: `core/src/realtime/` (publisher +
gateway), domain-service emits, `web-client/` consumer (`RealtimeService`,
router, footer). Unnumbered platform plan (M13 taken by MCP). Commits on
`dev`, no push.

## Locked decisions (all signed off)

- D1 native `ws@8.22.0` server-side + browser `WebSocket` client-side. No
  `@nestjs/websockets`. Zero client kB.
- D2 notify-never-state (binding); `health` the one state-carrying exception.
- D3 socket read-only for state (binding, spec-asserted: unknown messages → close 1003).
- D4 health interval client-requested (`subscribe {healthIntervalMs}`, clamped
  1–30 s server-side), reusing `icos-health-poll-seconds`.
- D5 resync on every (re)connect (health + sessions + approvals + questions + review).
- D6 origin allowlist `REALTIME_ALLOWED_ORIGINS` (default `*` dev + TODO).
- D7 no nginx proxy block.

## 1. Static verification

- Core: **38 files / 571 tests green**. `tsc` + `eslint` clean.
- Client: **43 files / 153 tests green**. `tsc` + `eslint` clean.
- Prod build: **280.01 kB initial** (budget 500 kB warn / 1 MB error; Phase 3 was
  274.53 kB — the delta is the consumer, no socket dependency shipped).
- AXE: chat + memory review/beliefs/ledger × dark/light — **8/8 clean, 0 violations**.
- Config: `REALTIME_ENABLED` (default true), `REALTIME_HEARTBEAT_MS`,
  `REALTIME_ALLOWED_ORIGINS` — all spec-covered incl. rejection of bad values.

## 2. Unit highlights

- Envelope shape, version guard, noop publisher, never-throws publish (B1).
- Subscriber-gated health push; room routing (scoped vs global
  `session.updated`); saturated-consumer drop; D3 close; teardown (B6).
- RecordingPublisher specs: approval created/resolved, clarification
  created/resolved, promotion proposed/terminals + claim.updated (B3/B4).
- Client: connect/subscribe/resync-on-hello, health-apply, router mapping
  (approval→chat+review, clarification→questions, promotion/claim→review,
  session→sessions), malformed-frame ignore, close→polling + backoff
  reconnect + resync, backoff cap 30 s (B2/B6).
- Footer: Online/Degraded/Offline incl. Degraded-on-socket-down spec.

## 3. Live runs (real `nest start` + `ng serve`, temporary harnesses removed)

- B1: `hello` on connect (v1 envelope); mutation message → close 1003;
  oversize frame → close 1009.
- B2: health push at subscribed cadence (~2010 ms for 2000 ms request);
  no subscription → no collection (gating); footer Online with **zero**
  periodic `GET /core/health` while connected (12 s window, route-counted).
- B3/B4: tab A (subscribed to session S) sees `approval.created` +
  `approval.resolved` with no reload; unsubscribed tab B sees nothing
  (room isolation). **Acceptance test for the whole plan: PASS.**
- B5: `session.updated` arrives with no subscription (global sidebar event)
  after `POST /core/conversation` → `status: ok`.
- B6: `REALTIME_ENABLED=false` → socket 404-refused, REST still 200
  (kill-switch isolates transport faults).
- B7 two-tab E2E (8/8): session created → tab A opens it → out-of-band
  approval visible with **no reload** → approve → tab A clears with no
  reload → tab B (never opened the session) isolated → zero periodic
  health GETs → footer Online.
- B7 degradation: core killed mid-session → footer **Offline** (REST down),
  chat shell still renders; core restarted → footer **Online** (backoff
  reconnect + hello resync).

## 4. Debug findings (kept for future work)

- `NoopPublisher.publish()` (zero-arg) shadowed the base `publish(event)` —
  jest passed (mocks bypass the override check), tsc flagged it only after
  rebuild. Fixed with `override publish(event)`. Lesson: run `tsc` before
  trusting publisher-seam specs.
- A `useFactory` alias on an abstract token does NOT duplicate the gateway
  (verified same-instance via Test probe) — but the scare forced the room
  discovery: unsubscribed sockets are silent BY DESIGN for session-scoped
  events; `trackSession()` is the client contract that makes it work.
- Stale `nest start` watch processes serve old `dist` — always `pkill`
  before live-probing after edits. (Also: `nest start` does not rebuild
  `dist`; `npm run build` does.)
- `host.docker.internal` does not resolve on bare-metal macOS (compose-only);
  live runs used `MEMORY_LLM_BASE_URL=http://localhost:11434/v1` override.
  Pre-existing config posture, unchanged by this plan.

## 5. Failure semantics verified

- Emit failures: logged, swallowed, never propagated (spec + live).
- Socket down: footer Degraded/Offline, polling covers within one interval,
  chat never breaks (spec + live kill/restart).
- Reconnect storm: backoff + jitter, cap 30 s, idempotent subscribe (spec).
- Slow consumer: buffer-saturated sockets skipped per broadcast (spec).
- Server restart: reconnect + resync, no durable event state (live).
- Kill-switch: `REALTIME_ENABLED=false` → UI identical to today (live 404 + 200).

## Definition of Done

With the socket up, the client issues no periodic HTTP requests, and any
state change in Core reaches every open client without user action. With
the socket down, the product behaves exactly as it does today, and says so
(Online / Degraded / Offline). Plus: `tsc` + `eslint` clean both projects,
all specs green, AXE clean, build in budgets, evidence committed, commits
on `dev`, no push.
