# Web Client — Phase 4 Evidence (Memory Review)

Date: 2026-09-26. Branch: `dev`. Scope: `web-client/` plus one additive
read endpoint in `core/` (`GET /core/promotions?state=&limit=`).
No behaviour changes to extraction, promotion, or conversation.
Committed on `dev`, no push.

## Locked decisions (all signed off during review)

- D1 Location: Review | Beliefs | Ledger in the Memory tab, `?view=` param. YES.
- D2 Badge: pending-review count on the Memory nav tab via root `MemoryReviewService`. YES.
- D3 Actions in Review only, global queue. YES.
- D4 Approve means approve *and* execute (approve → run → refresh, summary rendered). YES.
- D5 Resolution bypasses `ConversationStore` (no parked turn). YES.
- D6 `memory.promote` filtered out of chat (`MEMORY_PROMOTE_ACTION`). YES.
- D7 Never colour-only (icon + label, AXE clean). YES.
- D8 Resolved hidden by default (`showResolved` toggle, `limit=200`, `total` badge). YES.
- Numbering: Phase 4 in `web-client-plan.md`; realtime stays unnumbered platform work.
- Token: `--badge-red-text` (dark `#e07a72` / light `#af231c`).
- Retention: hide-by-default (D8), no ageing. Auto-promoted shown muted under resolved.

## 1. Core (Phase 4.0)

- `GET /core/promotions?state=&limit=` — additive; `/pending` byte-identical.
  Repeatable or CSV `state`, `IsIn(JOURNAL_STATES)`, `limit` 1–200 (default 50).
  Returns `{ promotions, total }` (total is pre-limit for honest badging).
- `PromotionService.listByStates()` shares the `listPending()` approvalJoin;
  `listPending()` delegates with `['proposed','promoting']`, limit 200.
- Unit: `promotion.service.spec.ts` 13/13 (new: state filter, terminal rows,
  approvalStatus join incl. null for AUTO, pre-limit total).
- Full core suite: **37 files / 558 tests green**. `tsc` + `eslint` clean.
- Live: `GET /core/promotions?state=...&limit=200` → 200 `{promotions,total}`;
  `/pending` → 200 `{pending}`; `?state=bogus` → 400.

## 2. Client (Phase 4.1–4.3)

- Models: `promotion.ts` (journal mirror + `reviewState()`/`willContradict()`/
  `contradictsClaimId()`), `claim.ts` (Claim mirror incl. reserved fields +
  `claimTone()`); specs cover the full §5 derivation matrix.
- Services: `MemoryReviewService` (items/total/showResolved/busyId/error/
  lastSummary; refresh/approve/reject/runPromotions; approve→run→refresh in
  order; 409 race treated as success-ish), `ClaimService` (list/search/detail).
- Components: `status-badge/` (shared icon+label), `memory-review-queue/`
  (statement join, missing-candidate disables approve, verbatim FAILED detail,
  sweep summary, truncation badge, focus return), `claim-list/` (filters
  status/category/origin, search, `degraded` banner, detail with evidence
  roles + provenance pair as candidate ids + dual confidences + history),
  `memory-tab/` (Review|Beliefs|Ledger, `?view=` sync, default review iff
  pending > 0 else beliefs), nav badge (`aria-label="Memory review, N pending"`,
  deep-links to `?view=review`).
- Chat decoupling: `refreshApprovals()` filters `action !== MEMORY_PROMOTE_ACTION`;
  spec asserts a `memory.promote` row never reaches `approvals()` while tool
  approvals pass through.
- Unit: **42 files / 143 tests green**. `tsc` + `eslint` clean.
  Prod build: **279.37 kB initial** (budget 500 kB warn / 1 MB error).

## 3. Contrast audit (computed, WCAG AA 4.5:1)

New `--badge-red-text`: dark `#e07a72` on card `#242424` 5.32 / on
`#25282a` 5.08; light `#af231c` on card `#ffffff` 6.82 / on `#e4e4e7` 5.37.
Re-verified existing pairs (amber/sage both themes, worst 4.89) — **12/12 pass**.

## 4. AXE (axe-core + Chromium via playwright-core, real `ng serve` + live core)

Pages: chat, memory review/beliefs/ledger × dark/light — **8/8 clean, 0 violations**.

## 5. E2E + live run (Chromium + live core :3000)

Script (temporary, removed): segments render (3) → seed `memory.promote`
approval → server holds it → review renders with Run control → beliefs shows
live claims with filters+search → nav deep-links `?view=review` → 390px no
overflow. **8/8 pass.**

Live transcript (real turn + real promotion path, seeded approval since the
memory extractor LLM was unreachable in this environment):
candidate → proposal → approve → `POST /core/promotions/run` →
`{new:5,...}` → `GET /core/claims` shows 5 `active` claims with evidence +
`NEW:committed` history. Reject path: `denied` row visible only under
`?state=denied`, second sweep `denied:0` (never retries). Approve→run→refresh
call order asserted in unit tests.

Caveat: the fire-and-forget extraction→proposal leg was NOT exercised live
(memory extractor points at an unreachable Ollama in this env); it is covered
by the pre-existing e2e (`promotes a candidate to a belief on approval plus
sweep`, still green in the 558).

## 6. Failure semantics verified

- Queue/beliefs failure: services clear + surface error, chat untouched (spec).
- Approve/reject failure: item stays PENDING, inline error, no optimistic change (spec).
- `runPromotions()` renders `{summary}` incl. denied/failed (spec + live).
- 409 race: refresh, no error (spec).
- Missing candidate: "evidence unavailable", approve disabled (spec).
- `degraded` search: badge + reason (spec).

## Definition of Done

A user opening the client sees every belief ICOS asks to hold, why, where
the evidence came from, and what happened to every past request — grants or
refuses in one place, result visible in the same view — without an open
session, a reload, or a colour cue they cannot perceive. Plus: `tsc` +
`eslint` clean both projects, unit green, AXE clean, build in budgets,
evidence committed, commits on `dev`, no push.
