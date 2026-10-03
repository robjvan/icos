# M15.5b Evidence — Claim / Evidence Consistency

**Date:** 2026-10-03. **Scope:** the deterministic classifier of an
assertion against the epistemic store. No secondary model (M15.5c), no
mitigation (M15.5d).

## What landed

- **`ClaimConsistencyService`** (`claim-consistency.service.ts`):
  `classify(assertion) → { classification, supportingClaimId,
  contradictingClaimId, fabricatedClaimIds, findings, reasons }`.
  - Looks up both polarities via `ClaimRepository.findByTriple`
    (`identity_key + negated`).
  - **`supported`** — an `active` claim matches the triple and polarity at
    or above `supportConfidenceFloor` (0.5).
  - **`contradicted`** — an `active` opposing-polarity claim, at or above
    the supporting claim's confidence (or with no support).
  - **`novel`** — nothing matches: new, **not** contradicted.
  - **`fabricated_provenance`** — a `citedClaimIds` entry that does not
    resolve to a stored claim.
  - Findings carry the catalogue's severity; the service detects only.
- **Types** (`hallucination.types.ts`): `ClaimAssertion`,
  `ClaimConsistency`, `ClaimFinding`, `ClaimConsistencyResult`.

## Mapping to the M15.5a catalogue

| mode | trigger |
| --- | --- |
| `unsupported_claim` (warning) | classification `novel` |
| `contradicted_claim` (critical) | classification `contradicted` |
| `overconfident_uncertainty` (watch) | `novel` and asserted confidence ≥ 0.8 |
| `fabricated_provenance` (critical) | a cited claim id that does not exist |

`silent_self_correction` is a mitigation-honesty check (M15.5d);
`unverifiable_high_stakes` is the secondary-model layer (M15.5c).

## Verification

- **963 unit green** (6 new): supported → no finding; novel → one
  `unsupported_claim` warning; novel at high confidence → also
  `overconfident_uncertainty`; opposing active claim → `contradicted_claim`
  critical; weak (0.3) and `retired` claims do **not** count as support;
  a fabricated citation is caught even when the assertion is otherwise
  supported.
- **`tsc` / `eslint` clean.**

## Deferred

Wiring the classifier into the turn path and choosing what to do with a
finding (M15.5d). No Nest module yet — the service is constructed where it
is used.
