# M12d Evidence — Activation

**Date:** 2026-10-01. **Scope:** salience orthogonal to truth —
touch, spread, disuse decay, divergence review, suppression, rank
re-score. No gates, no promotion, no UI changes.

## What landed

- **Touch + spread.** Accessed claims boost +0.3 (clamped [0, 1]);
  a fan-capped share (boost / min(fanout, 5), insertion-ordered
  first N) spreads along `related[]`. Null stays null until first
  touch — salience exists only for lived claims. Every write gets
  an `activate` history row.
- **Freshness without clocks.** Boost eligibility compares access
  *identity* (last-boost access string), not timestamps — same
  millisecond touches converge instead of ratcheting at any
  clock resolution. Caught by test, documented at the call site.
- **Disuse decay.** Untouched claims decay 0.05 per interval
  window (1h, gated — no per-pass spam).
- **Divergence review.** Activation ≥ 0.7 against confidence ≤
  0.4 on an active claim parks a clarification question (trigger
  `confidence_drop` — the confidence did drop; honest reuse),
  skipped when a question is already parked. The self-correction
  mechanism: loud-but-wrong surfaces for review instead of
  recalling confidently.
- **Suppression.** Trace-driven prologue (no M11 path changes):
  familiar-ranked claims in stored traces lose 0.1 activation,
  once per trace (newer `suppress` row than the trace means
  done). Confidence untouched — recalling sharpens the target
  without punishing neighbors' truth.
- **Rank re-score.** `fused ×= 1 + 0.2 × activation` with the
  lift in row reasons. Multiplicative within gated rows: admits
  nothing, gates nothing, creates no hits.
- **Ladder:** compound → decay → link → gist → revise → lock →
  activate → classify (append-only ordering preserved).

## Verification

- **694 unit green** (core): boost/spread/fan-cap/clamp math,
  spread with history, null-untouched, interval gating,
  divergence park + no-duplicate, suppression once-per-trace,
  rank re-score without gating, `setActivation` isolation.
- **48 e2e green**, incl. turn → access → pass → activation 0.3
  on the claim.
- **`tsc`/`eslint` clean.**

## Notable findings

- **Stale reads bite twice.** Revision re-reads before acting
  (M12c); activation compares access identity instead of clocks.
  Both are the same lesson: pass-start snapshots go stale by
  design in a mutating pass — re-read or compare values, never
  wall-clock order.
- **Suppression placement resolved.** The plan's "gentle default"
  lives in the pass prologue reading stored traces — M11 files
  untouched, per the M12 boundary. The cost is one `listAll()`
  on a bounded (100) store.
