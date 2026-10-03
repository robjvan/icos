# M15a Evidence — Failure Modes + Baselines

**Date:** 2026-10-03. **Scope:** the failure-mode catalogue and baseline
contract for M15. No detectors yet (M15b–d).

## What landed

- **`persona-drift.ts`** — the single source of truth for M15:
  - `PersonaFailureMode` (8 modes) with, per mode, its **layer**
    (`structural` / `semantic` / `cumulative`), **severity**, and a
    description.
  - `PERSONA_DRIFT_SEVERITY` — severity is derived from the catalogue, so
    a detector reports *the mode* and the table supplies the severity.
    An honest severity cannot drift with the implementation.
  - `PERSONA_BENIGN_BASELINES` — six situations that must raise **no**
    finding, the contract for M15e's false-positive matrix.
  - `PERSONA_DRIFT_DEFAULTS` — the intended default thresholds
    (freshness 48 h, pressure count 3, similarity 0.6, warm-up 0.6,
    semantic floor 0.25, cumulative min cycles 3).
- **Spec** (`persona-drift.spec.ts`, 5 tests): every mode has a layer +
  severity; the mode set is exactly the eight planned; the core/protected
  modes are `critical` and cumulative sits above at `cumulative`;
  benign baselines are declared; the defaults are the documented numbers.

## Why this is a slice

The M14 drift log already carries a severity union including `cumulative`
(M14a) and `core_contradiction` was logged by review refusal (M14f). M15a
freezes the full vocabulary *before* detection exists so that M15b–d
implement to a contract and M15e evaluates against declared expectations —
the roadmap's "regression-tested, not vibes" ask.

## Verification

- **`tsc` / `eslint` clean.**
- **5 new unit tests pass** (catalogue completeness, severity ordering,
  benign baselines, defaults).

## Next

M15b implements the structural detectors against this catalogue
(contradiction, staleness, pressure, low grounding) with `logOnce`
de-duplication and `resolve` reconciliation.
