# M15d Evidence — Cumulative Drift

**Date:** 2026-10-03. **Scope:** persistent direction change across review
cycles, on top of the M15c trend rows.

## What landed

- **`PersonaDriftService.detectCumulativeDrift(recordId)`**:
  - reads the record's trend rows (newest first) and counts the trailing
    run with `signal >= semanticDriftFloor`;
  - at `>= personaCumulativeMinCycles` consecutive elevated cycles, raises
    `cumulative_semantic_drift` at severity **`cumulative`** (above
    `critical`), with the cycle evidence (`reviewCycles`, `avgSignal`,
    `floor`, `requiredCycles`) in the finding;
  - `logOnce` fires it **once per open streak**;
  - when the newest trend drops below the floor the streak has broken:
    any open cumulative finding is **resolved**, so a later streak can
    fire again.
  - **The core is exempt by construction** — trends exist only for
    evolving records, so a cumulative finding about the core cannot occur.
- Called at the end of `evaluateSemanticChange`, so cumulative detection
  rides the same review hook (no new wiring).
- **Config / env**: `PERSONA_CUMULATIVE_MIN_CYCLES` (3).

## Verification

- **945 unit green** (2 new): three consecutive elevated cycles raise one
  `cumulative` finding with `requiredCycles: 3`; a fourth elevated cycle
  in the same streak adds nothing; a benign below-floor cycle resolves it;
  a fresh streak of three raises a second finding. A record with no trends
  raises nothing (the core-exempt case).
- **63 e2e green.**
- **`tsc` / `eslint` clean.**

## Note

Like M15c, this is the **mechanism**: streak detection, once-per-streak
de-duplication, and reconciliation are proven. Whether
`PERSONA_CUMULATIVE_MIN_CYCLES` / the floor are the right *numbers* is
calibration work — **M15e**.
