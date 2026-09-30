# M11e Evidence — Budgeting, Failure, and Uncertainty

**Date:** 2026-09-30. **Scope:** band budgets, recall latency
bound, declared uncertainty. No resolution, no revision, no UI.

## What landed

- **Band budget.** `MEMORY_RECALL_MAX_BAND_TOKENS` (default 800,
  `.env.sample`) caps the rendered memory band in estimated tokens
  (chars/4, documented approximation in `prompt-bands.ts`).
  `applyBandBudget` shrinks in a fixed, documented order —
  familiar near-misses first, then demoted rows, then lowest-fused
  recalled rows — and reports every drop as `budget:<id>` in the
  trace. Conflict/contradicted notes are never trimmed (they are
  short, honesty-critical, and budgeted against the rows). The user
  band is outside the function and can never be truncated for
  memory — pinned by test.
- **Latency budget.** `MEMORY_RECALL_TIMEOUT_MS` (default 5000):
  the recall→rank→compare pipeline races a timer; expiry degrades
  to bare context with `recall_error:recall_timeout`, never stalls
  the turn. Late pipeline rejections are attached, never unhandled.
- **Failure vocabulary (formalized).** Per-surface
  available/reason (M11a) + `recall_error` + `budget:*` /
  `gated:*` / `lens:*` trace entries: every degraded turn names
  its cause. Failed recall never fails a turn (pre-existing floor,
  now with timeout).
- **Uncertainty vocabulary.** Active miss on live surfaces renders
  `[memory: nothing recalled for this turn — no matching beliefs]`
  — declared, quotable, ordinary. Partial recall (any surface
  down) and empty queries stay bandless: "consulted and found
  nothing" and "could not fully consult" are different states and
  render differently. Recalled rows carry confidence; familiar
  rows carry the uncertain voice.

## Verification

- **656 unit green** (47 suites): estimate math, shrink order
  (familiar → demoted → low fused, exact drop sequence),
  notes-survive-budgeting, turn-level budget (user intact, access
  unobserved for dropped rows), active-miss marker, partial-recall
  silence, timeout degradation, lexical-down isolation.
- **47 e2e green**, incl. two updated expectations where the
  marker correctly joins exact-context assertions (trace bands,
  post-undo context).
- **`tsc` / `eslint` clean.**
