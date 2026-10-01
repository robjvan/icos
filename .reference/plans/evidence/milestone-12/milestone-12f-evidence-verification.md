# M12f Evidence — Dynamics Verification

**Date:** 2026-10-01. **Scope:** bullet-by-bullet mapping over
M12a–M12e plus the live leg (host-run core, scratch DBs, OpenRouter
chat + local gemma extraction, real embeddings).

## Bullet mapping

- **Reinforcement bounds.** Unit: 12-level asymptotic run pins
  monotonicity, per-pass step < 0.11, ceiling exactly 0.99, single
  observations never jump. Live: second-topic turn approved →
  sweep `REINFORCE` → confidence adopted per M10 rule (no
  compounding above the 0.99 ceiling — the pass correctly
  declined).
- **Decay honesty.** Unit: half-life math vs elapsed, category
  ordering, grace/floor/lock/shield matrix, floor pinning, memoryless
  re-pass convergence. Live: backdated claim decayed to its floor
  across passes with `decay` history rows.
- **Retirement.** Unit: window + confidence rule, force path,
  missing/null, re-retire silence. E2E: 400 → forced 200 →
  queryable with history → no-op → 404.
- **Revision integrity.** Unit: policy matrix, end-to-end rival
  resolution with links/history/reliability, one-active-head
  invariant over a mixed pass, crash audit pairing (no history
  without matching state). Invalidation (retracted sources):
  designed, explicitly unbuilt — no retraction source exists yet,
  and the plan's examples (correction turns, invalidated
  sessions) are interfaces, not data. Recorded as deferred, not
  hidden; nothing in M12 pretends otherwise.
- **Activation orthogonality.** Unit: boost/spread/fan-cap math,
  divergence park + no-duplicate, suppression once-per-trace,
  rank re-score without gating. Live: low-confidence tea belief
  accessed across three turns reached activation 1.0 and parked
  a `confidence_drop` question — loud-but-wrong surfaced for
  review instead of recalling confidently. (Design note the live
  run confirmed: gated claims (< 0.3) can't be accessed, so
  divergence lives in the 0.3–0.4 confidence window — below the
  gate there is nothing to be loud *in*.)
- **Maintenance safety.** Unit: per-record isolation with failed
  counts, crash audit (failed records carry zero history),
  ledger SHA-256 stable across all passes. Live: pass
  `durationMs: 2–3` against turns taking ~15s LLM-bound — no
  interference possible, and the guarantee is structural (no
  turn path awaits a pass) rather than measured headroom.
- **Source reliability.** Unit: win/loss accrual, Laplace factor
  math, rank dampening with trace reasons, neutrality without
  data. Dampening detail on compound history rows.

## Live leg transcript (scratch, destroyed after)

Seeded via real turns (language preference, tea habit) →
approved `NEW` ×2 → reinforce turn → `REINFORCE` → passes:
classified, activated (recall access observed), compound
declined at ceiling. Backdated + weakened tea claim decayed to
floor; re-driven through access cycles to activation 1.0 with a
parked divergence question. Ledger grew 14 → 29 rows purely via
extraction of new turns (unit checksum pins candidate
immutability across passes). Cleanup removed scratch DBs, logs,
and temp files; `core/.env` untouched throughout.

## Totals

701 unit green, 48 e2e green, 168 client green, `tsc`/`eslint`
clean both projects. M12 definition of done is met: beliefs
strengthen boundedly, decay honestly, revise visibly, retire
explicitly, salience tracks apart from truth, time is navigable —
the ledger never moved, turns never waited, and no belief was
silently rewritten.
