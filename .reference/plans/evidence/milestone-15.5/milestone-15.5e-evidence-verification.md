# M15.5e — Hallucination Mitigation: Evaluation + Verification

> Status: **complete** (2026-10-03).
> Definition of Done: ICOS detects unsupported/contradicted outputs, optionally
> verifies high-stakes claims with a provider-agnostic second model, and
> mitigates through explicit, logged actions — without suppressing legitimate
> novelty and without ever rewriting output silently.

This slice is verification, not new mechanism. Every bullet below is backed by
a committed test, a command that was run, and the observed result.

## Headline

| Check | Evidence | Result |
| --- | --- | --- |
| Detection — every failure mode | `core/src/hallucination/hallucination-matrix.spec.ts` | all reachable |
| False-positive / negative | same matrix + `claim-consistency.service.spec.ts` | novelty flagged, never refused |
| Secondary model | `claim-verifier.service.spec.ts` + live client spec | disagreement recorded, never auto-resolved; works with none |
| Mitigation honesty | `hallucination-mitigation.service.spec.ts` + `GET /core/hallucination/mitigations` | append-only, observable; nothing silent |
| Live end-to-end | `core/test/hallucination.e2e-spec.ts` against the real Jev 2B | caught + refused + logged |

Totals after this slice: **994 unit passed, 1 skipped** (the opt-in live
client spec) and **65 e2e passed**; `tsc` and `eslint` clean.

## 1. Detection — each failure mode produces its expected finding

`hallucination-matrix.spec.ts` ("reaches every deterministic failure mode")
drives each catalogue mode through the layer that owns it and asserts the
mode is produced. Severity is read from `HALLUCINATION_FAILURE_MODES`
(single source of truth), not re-declared in the test.

| Mode | Scenario | Layer | Severity |
| --- | --- | --- | --- |
| `unsupported_claim` | novel assertion, no match | deterministic | warning |
| `contradicted_claim` | active opposite-polarity claim | deterministic | critical |
| `fabricated_provenance` | cites a claim id that does not exist | deterministic | critical |
| `overconfident_uncertainty` | confidence 0.9 on no support | deterministic | watch |
| `unverifiable_high_stakes` | high-stakes, unresolvable, no verifier | secondary model | watch |
| `silent_self_correction` | *not a classifier outcome* — asserted by the ledger test (a non-`none` mitigation is always recorded) | — | warning |

`silent_self_correction` is intentionally not a finding the classifier emits:
it is the failure the ledger is designed to make impossible, and it is
verified by the mitigation-honesty test below.

### Correctness fix found while writing the live case

`unverifiable_high_stakes` previously fired for any non-`supported`
high-stakes classification — including `contradicted`, which *does* have an
answer from the store. Corrected in `claim-verifier.service.ts`: it now fires
only when the deterministic pass is **novel** (unresolved). This is what lets
the live end-to-end case resolve cleanly to a single `contradicted_claim`
finding.

## 2. False-positive / false-negative analysis

`hallucination-matrix.spec.ts` ("does not raise a critical finding on the
benign baselines") walks the declared benign baselines from
`HALLUCINATION_BENIGN_BASELINES`:

- **novel-but-uncontradicted** — classified `novel`, every finding below
  `critical`; flagged (warning), never refused.
- **appropriately-hedged** — low stated confidence (0.3) is not
  `overconfident_uncertainty`.
- **supported-claim** — an active, adequate claim yields **zero** findings.

False negatives are covered by the detection matrix (each mode must fire);
false positives by the baselines (these must not). `recorded-disagreement` and
`low-stakes-uncertainty` are declared and exercised in M15.5c / M15.5b specs.

## 3. Secondary model — surfaced, never hidden; optional

- **Disagreement recorded, not resolved** — the matrix test
  "records disagreement without rewriting the classification" configures a
  decision verifier that returns `contradicted` while the store *supports*
  the claim: `disagreement === true` and `classification` stays `supported`.
  The verifier is an input, never the authority.
- **Works without a verifier** — the whole matrix and the e2e run with
  `HALLUCINATION_DECISION_URL` unset; a high-stakes unresolved claim degrades
  to `unverifiable_high_stakes` (watch), not a crash and not a silent pass.
- **Tier is always recorded** — every `VerificationVerdict` carries
  `backend` and `independence`; the ledger detail stores
  `verifier: result.verification.backend`.

## 4. Mitigation honesty — logged, observable, never silent

- `hallucination-mitigation.service.spec.ts` proves the strictest-strategy
  selection and that a `none` plan is **not** logged.
- `hallucination-matrix.spec.ts` ("logs every mitigation — no silent
  behaviour") proves a `refuse` plan is recorded exactly once and a
  no-finding plan records nothing.
- **Observable**: `HallucinationController` exposes read-only, admin-only
  `GET /core/hallucination/mitigations`, backed by the append-only
  `hallucination_mitigations` ledger. The e2e reads the mitigation back
  through this endpoint — the same surface an operator sees.

## 5. Live — a real turn caught and mitigated end to end

`core/test/hallucination.e2e-spec.ts` boots the app, seeds a belief the store
already holds (`user prefers oak`, opposite polarity), runs a real turn whose
extraction yields an **assistant-sourced** claim of the affirmed triple, and
reads the mitigation back through the API.

```
Test Suites: 3 passed, 3 total   (full e2e)
Tests:       65 passed, 65 total
```

Opt-in live run (`JEV_LIVE_URL=http://127.0.0.1:8765`, the local Jev 2B on the
host via `bin/verifier`):

```
JEV_LIVE_URL=http://127.0.0.1:8765 npx jest --config test/jest-e2e.json \
  test/hallucination.e2e-spec.ts
Tests: 2 passed, 2 total
```

In that run the ledger row reports `verifier: decision` — the **real decision
model** answered for the turn, and the recorded mitigation is
`strategy: refuse, severity: critical, mode: contradicted_claim`. A raw call
to the same server returned `contradicted` at probability **0.907**
(`supported` 0.016 · `contradicted` 0.907 · `unknown` 0.077; backend `mlx`,
~1.9 s), and our `SystemoneVerifier` client mapped it correctly:

```
JEV_LIVE_URL=http://127.0.0.1:8765 npx jest \
  src/hallucination/systemone-verifier.live.spec.ts
Tests: 1 passed, 1 total
```

## Reproduce

```sh
# deterministic unit + e2e
cd core && npm test && npx jest --config test/jest-e2e.json

# live (macOS: start the verifier first)
bin/verifier &
JEV_LIVE_URL=http://127.0.0.1:8765 npx jest \
  src/hallucination/systemone-verifier.live.spec.ts
JEV_LIVE_URL=http://127.0.0.1:8765 npx jest --config test/jest-e2e.json \
  test/hallucination.e2e-spec.ts
```

## What M15.5 explicitly does not claim

- Blocking **pre-send** mitigation is a later slice; this audit is post-turn
  (fire-and-forget, fail-soft), so it never adds user-facing latency.
- No output is ever rewritten silently — that is the failure mode, not a
  feature.
- A verifier that is the **same** model as the speaker is recorded as `self`
  (self-consistency), never as independent verification.
