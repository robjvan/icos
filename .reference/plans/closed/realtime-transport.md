# Realtime Transport — Server-Pushed Events (core + web-client)

Status: **complete.** Evidence:
`.reference/plans/evidence/realtime-transport.md`
Scope: `core/` (event publisher + gateway) and `web-client/` (consumer).
Not a numbered roadmap milestone: this is platform work spanning both projects. Suggested
slot: a new `M13a`, or fold into the M13 sequence — **owner to confirm numbering.**
Branch: `dev`. Commits per-phase, **no pushing**.

---

## 1. Goal

Stop the client asking the server "anything new?" on a timer, and stop requiring a manual
refresh to discover work the server already knows about.

Two concrete symptoms (both traced to code, §2.2):

1. **Health poll.** `footer-component.ts:115-120` runs `setInterval` at a 5 s default
   (1–30 s slider), forever, to render three footer fields.
2. **Stale approvals.** Promotion approvals are created _after_ the client's last refresh,
   so pending work is invisible until reload. Same root cause as
   `web-client-phase4-memory-review.md` §1.

### Research question

> Can Core tell the client what changed, once, without the client polling, without making
> the socket a second source of truth, and without the client breaking when it drops?

### Non-goals

- **Turn streaming stays SSE.** `/core/conversation/stream` is a per-request,
  request-scoped, resumable stream keyed by `requestId`. It is correctly shaped already;
  moving it to a socket would buy nothing and cost the resume semantics. **Decision made,
  not deferred** (Q2 answer, 2026-09-26).
- No event persistence / event sourcing / replay log. Missed events are handled by resync
  (§5.3), not by storage.
- No auth/user model. The socket inherits today's LAN-trust posture; §10 flags the limit.
- No new cognition, no proactive recall, no M11/M12 behaviour.
- No changes to the M4 ledger or promotion logic beyond emitting notifications.

---

## 2. Ground truth (verified)

### 2.1 There is no event infrastructure at all

`grep -rn 'EventEmitter|@WebSocketGateway|socket.io|WebSocket|@Sse' core/src` → **zero hits.**
No gateway, no event bus, no `@nestjs/websockets` dependency. Every REST mutation is
pull-only: the client learns of it by asking again.

### 2.2 Relevant existing machinery

| Fact                                                                    | Evidence                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| SSE is hand-rolled on Express `res.write`, no library                   | `conversation.controller.ts:134-150`                     |
| CORS is permissive with an explicit TODO                                | `main.ts:24`                                             |
| Approvals already keep an event log                                     | `approval_events` table, `database.ts:80`                |
| Approvals are session-bound; resolve needs `sessionId` in the body      | `approval.service.ts:90-94`                              |
| Promotion proposes fire-and-forget, executes on explicit sweep          | `promotion.service.ts:101-117,372-389`                   |
| Client refresh seams already exist and are isolated                     | `conversation-store.ts:165-174,190-201,203-214`          |
| Health is fetched by `HealthService.refresh()`, scheduled by the footer | `health.service.ts:62-70`; `footer-component.ts:115-120` |
| Client has **no** socket dependency                                     | `web-client/package.json`                                |
| nginx serves the SPA with `try_files`, **no proxy to core**             | `web-client/nginx.conf`                                  |
| Client reaches core directly via `SERVER_URL` (:3000), CORS-brokered    | `constants.ts:6`                                         |
| Compose exposes 3000 and 4200 only                                      | `docker-compose.yml:16,54`                               |

### 2.3 The client is already built for this

`ConversationStore` refreshes in exactly three places and each is a single call
(`refreshSessions`, `refreshApprovals`, `refreshQuestions`). `HealthService.refresh()` is
one call. A push channel therefore does not need to understand client state — it needs to
invoke functions that already exist. That is the whole design.

---

## 3. Architecture

### 3.1 The invariant: notify, never state

> **Events carry identity and a hint, never authoritative state. Every event's handler
> re-reads through REST.**

Rationale, in order of importance:

1. **One source of truth.** The transcript, ledger and claim store are the system of
   record (M10a already decided this for RuVector). A socket that carries state creates a
   second store that can drift.
2. **Fallback correctness is free.** Polling and push invoke the _identical_ refresh
   functions, so the degraded path is not a second implementation to keep in sync.
3. **Testability.** Handlers stay pure-ish invocations of existing, already-tested fetches.

```text
core mutation ──emit{ids}──> socket ──> client router ──> existing refresh() ──> REST
                                                              (same path as polling)
```

### 3.2 Core: publisher seam, not direct coupling

Mirror the existing `ClaimIndex` boundary pattern — an interface injected into services,
implemented by the gateway, so services never import socket code and tests inject a noop:

```text
RealtimePublisher (interface)          core/src/realtime/realtime.publisher.ts
  publish(event: RealtimeEvent): void   // sync, never throws
├── RealtimeGateway   implements it    core/src/realtime/realtime.gateway.ts
└── NoopPublisher     when disabled     (tests, REALTIME_ENABLED=false)
```

- `publish()` is **synchronous and never throws**. A failed notification must never fail a
  turn, a promotion, or an approval — precedent: "indexing is best-effort, it never fails
  a commit" (`promotion.service.ts:239-250`).
- Injected into: `ApprovalService`, `ClarificationService`, `PromotionService`,
  `HealthService`, and the conversation service (turn completion).
- `ClaimIndex` shows the established shape; a `ClaimRepository`-style boundary for the
  emitter keeps it consistent with the M10 plan's own instruction ("write against a
  repository boundary, not a backend").

### 3.3 Core: gateway

```text
RealtimeGateway            core/src/realtime/realtime.gateway.ts
  attach(httpServer)       same HTTP server, same port — no new infrastructure,
                           no compose change, no new container (M10a's test applied)
  path                     /core/events   (distinct from the /core/* REST prefix)
  protocol                 { v: 1, type, at, sessionId?, payload }
  client → server          hello | subscribe | unsubscribe | ping      ONLY
  server → client          hello | heartbeat | health | approval.* | clarification.*
                           | promotion.* | claim.updated | session.updated | error
```

**Hard invariant — the socket is read-only for state.** The only client→server messages are
subscription and liveness. No mutation is reachable over the socket, ever. This preserves
the property the approvals controller states explicitly ("assistant text is structurally
incapable of approving anything"): the human authority path stays on explicit REST calls
with `sessionId` in the body.

**Rooms.** Clients subscribe by `sessionId` (and one global room for health/queue events).
Global fanout is acceptable at one-user scale; rooms prevent cross-session leakage later
and cost little now.

### 3.4 Event catalogue

| Event                                         | Payload                           | Emitted from                      | Client reaction                                 |
| --------------------------------------------- | --------------------------------- | --------------------------------- | ----------------------------------------------- |
| `hello`                                       | `{serverTime, v}`                 | on connect                        | mark connected, **full resync**                 |
| `heartbeat`                                   | `{at}`                            | server interval                   | liveness only                                   |
| `health`                                      | full `HealthReport`               | health interval, subscribers only | `HealthService.applyPush()`                     |
| `approval.created`                            | `{approvalId, sessionId, action}` | `ApprovalService.create`          | chat: `refreshApprovals()`; memory: `refresh()` |
| `approval.resolved`                           | `{approvalId, status}`            | `ApprovalService.resolve`         | both surfaces refresh                           |
| `clarification.created` / `.resolved`         | ids + sessionId                   | `ClarificationService`            | `refreshQuestions()`                            |
| `promotion.proposed`                          | `{journalId, candidateId}`        | `proposeCandidates`               | `MemoryReviewService.refresh()`                 |
| `promotion.committed` / `.denied` / `.failed` | `{journalId, claimId?, detail?}`  | `executeEntry` terminals          | review + beliefs refresh                        |
| `claim.updated`                               | `{claimId, status}`               | claim writes                      | beliefs refresh                                 |
| `session.updated`                             | `{sessionId}`                     | turn completion                   | `refreshSessions()`                             |

`health` is the one event that carries state. Justified: it _is_ the payload the client
renders, it is derived and volatile, and re-fetching it would defeat the purpose. It keeps
`GET /core/health` as the hydration + fallback path.

### 3.5 Degradation (non-negotiable)

> WebSocket down ⇒ the client behaves exactly as it does today.

- Client detects `close`/`error` ⇒ `connected = false` ⇒ **footer polling restarts** and the
  manual refresh semantics are unchanged. The existing slider keeps its meaning.
- `REALTIME_ENABLED=false` on core ⇒ gateway not attached, `/core/events` refuses, clients
  fall back to polling. The kill switch exists so a transport fault can never take the UI
  down.
- The socket is **auxiliary**, like the sidebar: failure never breaks chat.

Default is **on** (`REALTIME_ENABLED` default `true`), deliberately unlike
`MEMORY_PROMOTION_AUTO` (default off): auto-promotion _mutates state_, this only _notifies_
— and it degrades safely, which auto-promotion does not.

---

## 4. Decisions (sign-off requested)

- [x] **D1 — Transport library.** **Recommendation: native `ws` server-side + browser
      `WebSocket` client-side, zero new runtime dependencies both sides.**
      Rationale: the repo hand-rolled SSE rather than taking an EventSource polyfill, and
      values sovereignty ("must never hard-depend on a third-party store for basic
      function"). The protocol here is tiny and the one browser is one browser.
      _Alternative:_ `socket.io` — gives rooms/reconnect/long-poll fallback for free, costs
      a dep plus ~40 kB gzipped against a 500 kB budget (Phase 3: 274.53 kB). Choose this
      only if rooms and fanout are expected to grow sharply.
      **This is the one decision needed before Phase B0 starts.**
- [x] **D2 — Notify-never-state** (§3.1). Binding on every handler.
- [x] **D3 — Socket is read-only for state** (§3.3). Binding, no exceptions.
- [x] **D4 — Health push interval** is client-requested (`subscribe {healthIntervalMs}`,
      clamped 1–30 s server-side), reusing the existing `icos-health-poll-seconds`
      localStorage key so the settings slider keeps working unchanged.
- [x] **D5 — Resync on every (re)connect** (§5.3). Binding.
- [x] **D6 — Origin allowlist.** `REALTIME_ALLOWED_ORIGINS` (default `*` in dev, with a
      TODO matching `main.ts:24`'s existing note). Not a hardening phase — just not
      pretending the socket is exempt from the CORS posture.
- [x] **D7 — nginx.** No proxy block in this plan. The client reaches core directly today
      (`constants.ts:6`); adding an nginx proxy would change deployment shape and belongs
      in its own decision if core is ever fronted. Documented, not built.

---

## 5. Client architecture

### 5.1 `RealtimeService` (root)

```text
signals    connected, lastEventAt, transport ('ws' | 'polling')
owns       socket lifecycle, backoff, resubscribe, visibility/online recovery
exposes    events: Signal<RealtimeEvent | null>  (or a typed subject)
does NOT   own any domain state
```

### 5.2 Router

One small module maps `event.type` → existing calls. It contains no domain logic:

```text
approval.*        → ConversationStore.refreshApprovals() + MemoryReviewService.refresh()
promotion.*       → MemoryReviewService.refresh()        (+ beliefs refresh)
clarification.*   → ConversationStore.refreshQuestions()
session.updated   → ConversationStore.refreshSessions()
health            → HealthService.applyPush(payload)
hello             → full resync (§5.3)
```

### 5.3 Resync on connect — the correctness rule

> A socket delivers events that happen _while connected_. Anything that happened while
> disconnected is **not** replayed. Therefore: **on every connect and every reconnect, run a
> full refresh** (sessions, approvals, questions, review queue, beliefs, health).

Cheap (a handful of GETs), idempotent, and it removes the entire class of "missed event"
bugs without an event log. Any replay/sequencing design is explicitly out of scope.

### 5.4 Connection lifecycle

- Exponential backoff with jitter, capped (~30 s), reset on successful `hello`.
- Reconnect on `online` and on `visibilitychange → visible` (laptop wake is the common
  real failure, not the server).
- `subscribe {sessionId, healthIntervalMs}` re-sent after every reconnect.
- **Three-state footer status**, accessible (label + icon, never colour alone):
  `Online` (socket + REST healthy) · `Degraded` (REST fine, socket down → polling) ·
  `Offline`. Directly improves on today's binary `ServerStatus`.

### 5.5 Polling becomes the fallback path

`footer-component.ts` keeps its interval machinery but activates it only when
`realtime.connected() === false`. The slider, the localStorage key and the settings tab are
untouched — only _when_ polling runs changes. Net effect: **zero periodic requests while
connected.**

---

## 6. Work breakdown

### Phase B0 — Decision lock

- [x] D1 transport choice signed off; if native `ws`, confirm no `@nestjs/websockets` needed
- [x] Confirm numbering / plan-file placement (§11 Q4)

### Phase B1 — Core: publisher seam + gateway skeleton

- [x] `realtime.publisher.ts` (interface), `noop.publisher.ts`, `RealtimeGateway`
- [x] Attach to the existing HTTP server; `/core/events`; `hello` + `heartbeat`
- [x] `v:1` envelope + shared event-type union (single definition, both sides mirror it)
- [x] Config: `realtimeEnabled`, `realtimeHealthIntervalMs`, `realtimeAllowedOrigins`
- [x] Unit: publisher never throws when the socket is gone; noop publisher; envelope shape;
      client→server mutation messages are **rejected** (asserts D3)

### Phase B2 — Health push + client consumer + footer fallback

- [x] `HealthService` emits `health` on interval **only when ≥1 subscriber**
- [x] `RealtimeService` + router + `HealthService.applyPush()`
- [x] Footer: three-state status; interval active only when disconnected
- [x] Unit: push applies; on socket close polling resumes within one interval; backoff
      schedule (fake timers); resync fires on reconnect

### Phase B3 — Approvals + clarifications

- [x] Emit `approval.created`/`.resolved`, `clarification.created`/`.resolved`
- [x] Router wiring for chat + memory review
- [x] **Live proof:** approve in tab A → tab B updates with no reload (the acceptance test
      for the whole plan)

### Phase B4 — Promotions + claims

- [x] Emit `promotion.proposed` / terminal states from `executeEntry`, `claim.updated`
- [x] `MemoryReviewService.refresh()` on those events (the seam reserved in
      `web-client-phase4-memory-review.md` §9.4)
- [x] Live proof: candidate mined in a turn → Review badge increments with no interaction

### Phase B5 — Sessions + turn completion

- [x] `session.updated` after a turn commits; sidebar refreshes across tabs

### Phase B6 — Degradation + hardening

- [x] `REALTIME_ENABLED=false` → UI identical to today (explicit test)
- [x] Kill the core mid-session → client degrades, chat keeps working, recovers on restart
- [x] Origin allowlist enforced; malformed/oversized frames closed, not crashed on
- [x] Long-idle reconnect verified

### Phase B7 — Verification + evidence

- [x] Unit: publisher/wiring, router mapping table, backoff, resync-on-connect, subscriber
      gating of health
- [x] E2E: two browser contexts, out-of-band approval visible without reload; drop the
      socket mid-test and assert polling covers the gap; assert **zero** periodic health
      requests while connected
- [x] Live-run transcript (docker compose up, real turn, real promotion)
- [x] `tsc` + `eslint` clean in **both** projects; `ng test` green; AXE clean; budgets
- [x] Evidence: `.reference/plans/evidence/realtime-transport.md`

---

## 7. Failure semantics

- Emit failures: logged, swallowed, never propagated (`publish()` never throws).
- Client socket failure: never breaks chat; polling takes over.
- Reconnect storm: backoff with jitter; `subscribe` idempotent server-side.
- Slow/absent consumer: server drops events for a socket whose buffer is saturated rather
  than growing unbounded — a notification is worthless if the client must catch up on a
  hundred stale ones (resync already covers it).
- Server restart: clients reconnect, resync, continue. No durable event state to corrupt.

---

## 8. Definition of Done

> With the socket up, the client issues no periodic HTTP requests, and any state change in
> Core reaches every open client without user action. With the socket down, the product
> behaves exactly as it does today, and says so.

Plus: `tsc` + `eslint` clean both projects, all specs green, AXE clean, evidence committed,
commits on `dev`, no push.

---

## 9. Why not the alternatives

| Alternative                                     | Why not                                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep polling, just increase the interval        | Doesn't fix the approval-staleness bug at all — that is a _push_ problem, not a frequency problem                                                                                               |
| Long-poll `GET /core/events?since=`             | One held connection per client, worse failure modes than a socket, and still needs the resync logic                                                                                             |
| SSE for events too (reuse the existing pattern) | Unidirectional so it _fits_ the model, but one connection per event class, awkward reconnect semantics, and HTTP/1.1's 6-connection-per-origin limit becomes real with several SSE streams open |
| Move turns onto the socket as well              | Loses per-request resume semantics for no gain; explicitly out of scope (§1)                                                                                                                    |
| Event log + replay so no resync needed          | Real complexity, new storage, and resync is a handful of GETs. Solve it with resync until it actually hurts                                                                                     |

---

## 10. Risks (incl. honest security note)

| Risk                                                                                                                                                | Mitigation                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unauthenticated socket on the LAN** — same trust as today's permissive CORS, but a _push_ channel leaks activity to anyone who can reach the port | D6 allowlist; read-only-for-state (D3) means the socket grants no authority; flag as a real prerequisite if ICOS is ever exposed beyond the LAN |
| Second source of truth creeping in                                                                                                                  | D2, enforced by review + a spec that handlers only call refresh functions                                                                       |
| Missed events during dropout                                                                                                                        | D5 resync on connect                                                                                                                            |
| Client bundle growth                                                                                                                                | D1 (native WebSocket = 0 kB)                                                                                                                    |
| Health interval × N clients = N× health collection                                                                                                  | Subscriber gating + rooms                                                                                                                       |
| Reconnect churn thrashing core                                                                                                                      | Backoff + jitter + idempotent subscribe                                                                                                         |

---

## 11. Open questions (owner: Rob)

1. **D1** — native `ws` (recommended) or `socket.io`? Everything else is downstream.
2. **Numbering** — is this `M13a`, a new milestone, or an unnumbered platform plan kept
   beside `db-split-evidence.md`? Affects `status.md` and `full-roadmap-extended.md`.
3. **Should the client consumer be tracked as web-client Phase 5?** Keeps the client's
   phase series intact; the core half stays in this plan.
4. **Health payload over the socket** — full report (proposed, simpler) or only the three
   footer fields (smaller, but then the metrics tab needs its own path)?
