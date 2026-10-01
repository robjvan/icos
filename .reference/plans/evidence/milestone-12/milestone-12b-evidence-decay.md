# M12b Evidence — Decay and Forgetting

**Date:** 2026-09-30. **Scope:** passive decay, deliberate
retirement. Suppression fully deferred to M12d (it writes
`activation`, which M12d owns — splitting the write from the
read would buy nothing).

## What landed

- **Passive decay.** Exponential half-life past a 30-day grace,
  per-category rates (preference 0.8×, fact 1.0×, procedure 1.5×,
  relationship 2.0×) and floors (0.15/0.2/0.25/0.3). Locked claims
  never decay; access within 7 days shields without strengthening
  (the M12a-listed anti-decay rule, implemented here as the
  consumer). Decay never deletes and never raises — at/below
  floor is a no-op.
- **Memoryless increments.** Each pass bills only elapsed time
  since the last decay row (grace is a one-time allowance on
  first decay). Same-instant re-runs converge; wall-clock passes
  strictly decrease toward the floor, which pins permanently.
  History rows carry the audit (before/after + category).
- **Ladder order.** Compound outranks decay per record per pass:
  fresh corroboration beats old neglect. Later slices add rungs
  without reordering.
- **Deliberate retirement.** `POST /core/claims/:id/retire` —
  eligibility (180-day unretrieved window + ≤0.3 confidence) or
  `force` (explicit "forget this", caller = HITL authority,
  bypass recorded). Missing → 404, ineligible → 400, re-retire →
  silent no-op. Status transition + `retire` history row; the row
  stays queryable with full history.

## Verification

- **675 unit green** (49 suites): half-life math vs elapsed time,
  category rate ordering, grace/floor/lock/shield matrix,
  idempotent re-pass, floor pinning, service decay + history,
  ladder priority, eligibility matrix, retire/force/missing/
  re-retire, all with ledger untouched.
- **48 e2e green**, incl. retire flow (400 → forced 200 →
  retired detail with history → no-op re-retire → 404).
- **`tsc` / `eslint` clean.**

## Notable findings

- **Same-instant convergence needs memoryless increments.** The
  first formulation decayed from birth every pass (wall-clock
  history rows made time-travel tests ratchet). Fixed by billing
  elapsed-since-last-decay — caught by test, documented in code.
- **Suppression placement resolved.** M12d will detect near-miss
  competitors and write activation deltas in one place; M12b
  writes nothing toward it. The plan's "gentle default" language
  is preserved as a requirement on M12d, not a half-built hook.
