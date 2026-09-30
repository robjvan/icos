# Web Client — Phase 4: Memory Review (`web-client/`)

Status: **complete 2026-09-26** — shipped on `dev` (commits `2cb8655`,
`0e60425`, no push). Evidence:
`.reference/plans/evidence/web-client-phase4-memory-review.md`
(558 core + 143 client tests, AXE 8/8, E2E 8/8, live transcript).
The §3 locked decisions below are the as-built record; §11 open
questions carry forward to Phase 5 where noted.
Scope: `web-client/` **plus one additive read endpoint in `core/`** (see §2.3 — the
requested design is not satisfiable without it). No behaviour changes to extraction,
promotion, or conversation.
Source-of-truth hierarchy: `.reference/web-client-blueprint.md` → `web-client-plan.md`
→ this plan → code.
Branch: `dev`. Commits per-phase, **no pushing**.

---

## 1. Goal

Make belief review impossible to miss, and stop routing `memory.promote` through the
generic chat approval card.

The current path fails in three compounding ways (all verified in code, §2.2):

1. A promotion approval is created asynchronously (fire-and-forget off extraction),
   _after_ the client's last refresh — so it is invisible until a manual reload.
2. The client only asks for approvals belonging to the **currently open session**; with
   no session open it returns an empty list outright.
3. It renders as a generic card identical to a tool approval, which is a _different kind
   of thing_ (see §2.1) and therefore easy to skim past.

### Research question

> Can a user see everything ICOS wants to believe, understand why, and grant or refuse
> authority — in one place that does not depend on which session happens to be open?

### Non-goals

- Feeding beliefs into agent context — that is M11, and this tab must not imply it.
- Editing, retracting, merging, or decaying claims (M12).
- Any WebSocket work — that is `.reference/plans/realtime-transport.md`, which will later
  drive this tab live (§9.4 seam).
- Any change to extraction, candidate validation, promotion logic, or the M4 ledger.
- A new top-level nav tab (decision: it lives inside the existing Memory tab).

---

## 2. Ground truth (verified)

### 2.1 Two axes, not one — the core design point

The requested colours mix two independent lifecycles. They cannot share a single status
field, because a claim can be _contradicted_ while a _replacement promotion is pending_.

**Axis A — review disposition** (the `promotion_journal` row + its approval):

```text
proposed ──approve──> (approval approved, journal still proposed)
                            │ POST /core/promotions/run
                            └──> promoting ──> committed | failed
         ──reject───> denied (terminal, never retried)
```

**Axis B — claim lifecycle** (`claims.status`): `candidate | active | contradicted | retired`.

So the Memory tab needs two lenses over one dataset, not one list:

- **Review** — queue of Axis A items (actionable). This is the fix for "easy to miss".
- **Beliefs** — browse Axis B claims (read-only inspection).

Amber belongs to **Axis B** (`contradicted`); the pending→approved→rejected ramp belongs
to **Axis A**. The plan keeps them visually distinct rather than collapsing them.

### 2.2 Current state

| Fact                                                                           | Evidence                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Memory tab exists, reads only the candidate ledger                             | `memory-tab/memory-tab.ts:19,26`; `memory-candidate.service.ts:19`      |
| Single flat list, manual Refresh, no state colour                              | `memory-tab/memory-tab.html:6,27-47`                                    |
| Nav has 16 tabs incl. `memory`, no badge capability                            | `nav-tabs-component.ts:60-77`                                           |
| Chat lists approvals for the open session only; resets to `[]` with no session | `conversation-store.ts:190-201`                                         |
| Chat refreshes approvals only after a turn or a resolve                        | `conversation-store.ts:114-116,128,232-234,260-262`                     |
| Promotion approvals are generic (`action: 'memory.promote'`)                   | `promotion.service.ts:31,134-138`                                       |
| Proposal is fire-and-forget off extraction                                     | `promotion.service.ts:101-117`                                          |
| Approving **records authority only** — `run` executes it                       | `promotions.controller.ts` docblock; `promotion.service.ts:230,372-389` |
| Queue endpoint already returns `approvalStatus`                                | `promotion.service.ts:391-408`                                          |
| Claim detail already resolves evidence + journal history                       | `claims.dto.ts` `ClaimDetailResponseDto`                                |
| Colour tokens exist for sage/amber/red; **no muted or red-badge token**        | `styles.css:9-69`                                                       |

### 2.3 The gap that forces a core change

`GET /core/promotions/pending` lists **non-terminal rows only** (`listByState(['proposed','promoting'])`).
Terminal rows `committed`/`denied`/`failed` are **not listable anywhere** — only
incidentally via `GET /core/claims/:id` for claims that were actually created.

Consequence: **"rejected are red" cannot be built today.** A rejected promotion leaves the
queue forever, and once the chat surface filters `memory.promote` out (§3.2) it becomes
invisible in the entire product.

Required addition (additive, non-breaking, mirrors the existing `/pending` route):

```text
GET /core/promotions?state=proposed,promoting,committed,denied,failed&limit=200
  → { promotions: (PromotionJournalEntry & { approvalStatus: string | null })[] }
```

Implemented as `listByState(states)` + the same approvalJoin as `listPending()`.
`GET /core/promotions/pending` stays exactly as-is (other consumers, incl. the test client).
Optionally add `?ids=` to the candidates endpoint to avoid the full-list join (§4.3).

### 2.4 Noted inconsistency (not this phase's job)

`milestone-10-epistemic-memory.md:223` states `retired` "has no writer until M12", but
`promotion.service.ts:324-326` retires `candidate`-status claims on CONTRADICT. Either the
plan text or the code is wrong. Flagged for M10f verification; do not silently "fix" here.

---

## 3. Locked decisions (sign-off requested)

- [x] **D1 — Location.** Memory tab gains three segments: **Review | Beliefs | Ledger**.
      `Ledger` is the existing candidate list, unchanged. Segment is a route query param
      (`/memory?view=review|beliefs|ledger`) so the nav badge can deep-link to Review.
      Default segment: `review` when `pendingCount > 0`, else `beliefs`.
- [x] **D2 — Badge.** Memory nav tab shows a pending-review count. Requires a shared
      count signal, so the queue state moves into a root service (`MemoryReviewService`),
      not component state.
- [x] **D3 — Actions.** Approve / Reject live in the Review lens only. Queue is **global**,
      never session-filtered.
- [x] **D4 — Approve means approve _and_ execute.** After a successful
      `POST /core/approvals/:id/approve`, the client calls `POST /core/promotions/run`,
      then re-fetches. Approving without running leaves the row parked in an
      easily-mistaken state (see the `AWAITING_SWEEP` row in §5) — the UI must never imply
      a belief exists when only authority was recorded. A standalone **Run promotions**
      button is also exposed.
- [x] **D5 — Resolution must not go through `ConversationStore`.** Memory promotions park
      no turn. `ConversationStore.resolveApproval()` exists to consume `pendingResumes` and
      resume a stream; routing memory reviews through it is semantically wrong. Separate path.
- [x] **D6 — `memory.promote` is filtered out of the chat approval surface**
      (`conversation-store.ts:190-201`), via one shared constant.
- [x] **D7 — Never colour-only.** Every state carries an icon _and_ a text label.
      WCAG 2.1 AA + AXE clean is binding (`web-client/AGENTS.md`); colour-only status
      fails WCAG 1.4.1. The Phase 3 contrast matrix (24/24) is extended with the new pairs.
- [x] **D8 — Resolved items are hidden by default.** The queue shows open items; a
      "Show resolved" toggle reveals committed/denied/failed (bounded `limit=200`).
      Otherwise the queue grows without bound.

---

## 4. Data contract (all existing unless marked ADD)

| Need                      | Call                                                   | Notes                                                     |
| ------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Review queue              | `GET /core/promotions/pending`                         | open rows + `approvalStatus`                              |
| Queue incl. resolved      | `GET /core/promotions?state=&limit=`                   | **ADD** (§2.3)                                            |
| Execute after approve     | `POST /core/promotions/run`                            | returns `{summary}`                                       |
| Approval → owning session | `GET /core/approvals/:id`                              | needed: resolve requires `sessionId`, the queue is global |
| Approve / Reject          | `POST /core/approvals/:id/approve\|reject {sessionId}` | never `cancel` for reviews                                |
| Beliefs list              | `GET /core/claims?status=&category=&origin=&limit=`    | filters are status/category/origin/limit — **not `kind`** |
| Belief search             | `GET /core/claims/search?q=&k=`                        | returns `{results,degraded,reason}`                       |
| Belief detail             | `GET /core/claims/:id`                                 | already resolves `evidence[]` + `history[]`               |
| Statement text for a row  | `GET /core/memory-candidates?sessionId=&limit=`        | join by `candidateId` (§4.3)                              |

### 4.3 The statement join

Journal rows carry `candidateId`, not text. Statements come from the ledger, joined
client-side into an id→candidate map, fetched once per refresh and cached in the service.

- Missing candidate (ledger row gone): render "evidence unavailable", **disable approve**
  — core would fail the row with `missing_candidate` anyway, so offering the button lies.
- Optional core add: `?ids=` on the candidates endpoint to shrink the join. Not required;
  the ledger is small at current scale.

### 4.4 `degraded` is not optional

`/core/claims/search` returns `degraded: true` + `reason` when the claim index is
unavailable. The UI must render that honestly (badge + reason), never silently show
partial results as complete — same policy as the existing
"ranking unimplemented (M10–M12)" badge.

---

## 5. State → presentation mapping

**Axis A (Review lens)**

| State            | Derivation                                                       | Actions         | Token                             | Icon + label                          |
| ---------------- | ---------------------------------------------------------------- | --------------- | --------------------------------- | ------------------------------------- |
| `PENDING`        | journal `proposed`/`promoting` + approval `pending`              | Approve, Reject | default text                      | clock · "Awaiting review"             |
| `AWAITING_SWEEP` | journal `proposed`/`promoting` + `approvalStatus === 'approved'` | Run promotions  | `--badge-amber-text`              | play · "Approved — not yet committed" |
| `APPROVED`       | journal `committed`, `approvalId` set                            | none            | muted (`--text-secondary`)        | check · "Committed"                   |
| `AUTO`           | journal `committed`, `approvalId === null`                       | none            | muted + "auto" chip               | zap · "Self-promoted"                 |
| `REJECTED`       | journal `denied`, or approval `rejected`/`cancelled`             | none            | `--badge-red-text` **ADD**        | x · "Rejected"                        |
| `FAILED`         | journal `failed`                                                 | none            | `--badge-red-text` + warning ring | alert-triangle · "Failed — <detail>"  |

`FAILED.detail` is rendered verbatim (`unknown_origin`, `missing_candidate`, `error:…`).
These are the honest failure reasons core already produces; do not paraphrase them.

**Axis B (Beliefs lens)**

| `claims.status` | Token                                 | Icon + label                                 |
| --------------- | ------------------------------------- | -------------------------------------------- |
| `active`        | default                               | check · "Active"                             |
| `candidate`     | muted                                 | circle-dashed · "Candidate (not yet active)" |
| `contradicted`  | `--badge-amber-text` (the warm amber) | alert-triangle · "Contradicted"              |
| `retired`       | muted + strikethrough                 | minus-circle · "Retired"                     |

A Review row whose journal `operation` is `CONTRADICT` (also visible as
`detail: intent:CONTRADICT`) additionally carries an amber "will contradict" chip, linking
to the claim it contests. That is the one place the two axes meet, and it is deliberate.

**New token:** `--badge-red-text` in both themes, chosen for ≥4.5:1 against
`--bg-card` and `--bg-primary`, and added to the contrast matrix. Amber and red already
exist (`--badge-amber-text`, `--accent-red`) but no badge-grade red text token does.

---

## 6. Work breakdown

### Phase 4.0 — Core read endpoint (ADD)

- [x] `GET /core/promotions?state=&limit=` — additive; `/pending` untouched
- [x] DTO validation: `state` repeatable/CSV, `IsIn(JOURNAL_STATES)`, `limit` 1–200
- [x] Unit specs: empty result, multi-state filter, terminal rows included, bad state rejected
- [x] Verify `tsc` + `eslint` clean in `core/`

### Phase 4.1 — Models + services (client)

- [x] `models/claim.ts` (mirror `Claim`, incl. reserved fields as present-but-unused),
      `models/promotion.ts` (mirror `PromotionJournalEntry` + `approvalStatus`)
- [x] `MemoryReviewService` (root, signals): `items`, `pendingCount`, `showResolved`,
      `busyId`, `error`; `refresh()`, `approve(id)`, `reject(id)`, `runPromotions()`
- [x] `ClaimService` (root): `list(filters)`, `search(q)`, `detail(id)`; surfaces `degraded`
- [x] Shared `reviewState()` + `claimTone()` pure functions (the §5 tables) — one tested
      function each, no `switch` duplicated across templates
- [x] `constants.ts`: `PROMOTIONS_ENDPOINT`, `CLAIMS_ENDPOINT`, `MEMORY_PROMOTE_ACTION`

### Phase 4.2 — Components

- [x] `status-badge/` — shared, accessible (icon + label + colour), used by both lenses
- [x] `memory-review-queue/` — rows, statement, origin, confidence, age, actions, error
      banner, "Show resolved" toggle, empty state distinct from "failed to load"
- [x] `claim-list/` — filters (status/category/origin), search box, `degraded` banner
- [x] `claim-detail/` — evidence list (with per-item `role`), provenance pair
      (`firstAssertedAt` vs `lastSurfacedAt`), `extractorConfidence` vs `confidence`
      shown as **two distinct fields**, promotion history
- [x] `memory-tab/` — three segments, ARIA tablist, `?view=` sync, Ledger unchanged
- [x] `nav-tabs-component/` — badge on Memory, `aria-label="Memory review, N pending"`,
      rendered only when N > 0

### Phase 4.3 — Chat surface decoupling

- [x] `conversation-store.ts` filters `action !== MEMORY_PROMOTE_ACTION` in
      `refreshApprovals()`; tool approvals unaffected
- [x] Spec asserting a `memory.promote` approval never reaches `approvals()`

### Phase 4.4 — Accessibility + polish

- [x] AXE clean on all three segments (both themes)
- [x] Keyboard: segments, queue rows, toggles; focus return after approve/reject
- [x] `aria-live="polite"` on the pending count; badge is not the only signal
- [x] Contrast matrix extended: `--badge-red-text` on card/primary, both themes

### Phase 4.5 — Verification + evidence

- [x] Unit: full §5 derivation matrix (every journal state × approval status), service
      call-order (approve → run → refresh, asserted in order), failure isolation,
      missing-candidate disables approve, `degraded` surfaced
- [x] E2E vs live core (playwright-core, the Phase 3 convention):
      candidate → proposal appears in Review on refresh → approve → run → Beliefs shows
      the new `active` claim with its evidence → reject a second item → renders red and
      never retries → a `contradicted` claim renders amber with icon+label
- [x] Live-run: one real promotion driven end-to-end through the UI, transcript pasted
- [x] Prod build within budgets (500 kB warn / 1 MB error; Phase 3 was 274.53 kB)
- [x] Evidence: `.reference/plans/evidence/web-client-phase4-memory-review.md`

---

## 7. Failure semantics

- Queue/beliefs failure never breaks chat (chat is the primary surface) — same policy as
  sidebar/approvals today.
- Approve/reject failure: item stays `PENDING`, error surfaced inline, **no optimistic
  state change**.
- `runPromotions()` always renders its returned `{summary}` counts, including
  `denied`/`failed`. A silent partial sweep is exactly the failure mode this tab exists
  to prevent.
- Resolution race (already resolved elsewhere → `409 Conflict`): treat as success-ish —
  refresh and show the true state rather than an error the user can't act on.
- Never auto-retry a denial (core: "denial leaves the candidate unpromoted with no retry
  loop") — the UI must not offer one.

---

## 8. Definition of Done

> A user opening the client can see every belief ICOS is asking to hold, why it is asking,
> where the evidence came from, and what happened to every past request — grant or refuse
> it in one place, with the result visible in the same view — without an open session, a
> page reload, or a colour cue they cannot perceive.

Plus: `tsc` + `eslint` clean, `ng test` green, AXE clean, contrast matrix extended,
evidence committed, commits on `dev`, no push.

---

## 9. Dependencies and seams

- **9.1 Requires M10e?** No. The queue works on M10c/M10d surfaces today. But `M10e`'s
  `prospective_items` (contradiction clarification queue) has a natural home as a fourth
  segment — reserve the seam, build nothing. (Built as Phase 5 scope — see
  `web-client-phase5-contradiction-transparency.md`.)
- **9.2 The `AWAITING_SWEEP` state is load-bearing.** It is the only visible difference
  between "authority recorded" and "belief exists". If D4 is rejected, this row becomes
  the sole protection against the user believing something that isn't true yet.
- **9.3 Config coupling.** If `MEMORY_PROMOTION_AUTO` is on for a kind, items self-promote
  and never enter the queue. They still appear as `AUTO` under "Show resolved" so the
  queue cannot be quietly bypassed.
- **9.4 Realtime seam.** `realtime-transport.md` will call `MemoryReviewService.refresh()`
  on `promotion.*` and `approval.*` events. This phase deliberately polls on open, on
  action, and on manual refresh — correct without WS, and the service seam makes the later
  change a wiring edit rather than a rewrite.

---

## 10. Risks

| Risk                                            | Mitigation                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Queue silently grows (every turn can propose)   | D8 resolved-hidden default, `limit=200`, count badge                    |
| Two axes visually confused → wrong mental model | §2.1 explicit separation; amber reserved for claims                     |
| Approve-without-run looks like success          | D4 auto-run + `AWAITING_SWEEP` row + summary render                     |
| New red token fails AA contrast                 | §5 token chosen against both themes, matrix extended                    |
| A global queue with no auth                     | Already the case for `/core/*`; LAN-only today, unchanged by this phase |

---

## 11. Open questions (owner: Rob)

1. **Resolved-item retention** — hide forever (D8), or age out after N days? Hiding is
   reversible and needs no schema; ageing needs a decision and possibly core work.
2. **Auto-promoted visibility** — show muted (recommended, §9.3) or hide entirely?
3. **Token naming** — `--badge-red-text` acceptable, or would you rather a
   `--status-*` family since this is the first real status system in the client?
4. **Numbering** — does this become "Phase 4" in `web-client-plan.md` (assumed), or does
   it warrant its own plan file name?
