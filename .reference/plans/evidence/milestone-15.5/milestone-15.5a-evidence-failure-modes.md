# M15.5a Evidence — Failure Modes + Baselines

**Date:** 2026-10-03. **Scope:** the hallucination failure-mode catalogue
and baseline contract. No detectors yet (M15.5b–d).

## What landed

- **`core/src/hallucination/hallucination-modes.ts`** — the single source
  of truth for M15.5:
  - `HallucinationFailureMode` (6 modes), each with a **detection layer**
    (`deterministic` / `secondary_model`), a **severity** (`info` ·
    `watch` · `warning` · `critical`), and a description:
    - `unsupported_claim` (deterministic, warning) — asserted with no
      supporting evidence, not contradicted,
    - `contradicted_claim` (deterministic, critical) — the store
      contradicts it with higher-confidence evidence,
    - `fabricated_provenance` (deterministic, critical) — cites evidence
      that does not exist or does not support it,
    - `overconfident_uncertainty` (deterministic, watch) — high asserted
      confidence on weak support,
    - `silent_self_correction` (deterministic, warning) — output changed
      without a recorded mitigation,
    - `unverifiable_high_stakes` (secondary_model, watch) — neither the
      evidence nor a deterministic pass can resolve it.
  - `HALLUCINATION_SEVERITY` derives severity from the catalogue, so a
    detector reports *the mode*.
  - `HALLUCINATION_BENIGN_BASELINES` — the false-positive contract for
    M15.5e, including **`novel-but-uncontradicted`** (novelty is not
    failure) and **`recorded-disagreement`** (a second model disagreeing is
    recorded, not an error).
  - `HALLUCINATION_DEFAULTS` — `supportConfidenceFloor` (0.5),
    `highStakesConfidenceFloor` (0.8).
- **Spec** (`hallucination-modes.spec.ts`, 6 tests): every mode has a
  layer + severity; the set is exactly the six planned; contradictions and
  fabricated provenance are `critical`; only `unverifiable_high_stakes` is
  reserved for the secondary-model layer; benign baselines include novelty
  and recorded disagreement; the defaults are the documented numbers.

## Why the deterministic layer dominates

Most modes are decidable **without a model** — evidence is the arbiter
(M10 provenance). Only `unverifiable_high_stakes` needs a second model, and
that is an *input, never the authority* (M15.5c). This keeps the milestone
deterministic-first, matching the M15 lesson: deterministic checks first,
model verification second.

## Verification

- **`tsc` / `eslint` clean.**
- **6 new unit tests pass** (catalogue completeness, severity ordering,
  layer reservation, benign baselines, thresholds).

## Note (from M15e)

The embedding path is unavailable under ts-jest (`A dynamic import callback
was invoked without --experimental-vm-modules`); M15.5's fixtures must
therefore be deterministic, with any model-dependent scoring run as a
plain-node harness, exactly as the M15e corpus scorer does.

## Next

M15.5b implements the deterministic claim/evidence classifier
(supported · contradicted · novel) against this catalogue.
