# M15.5e0 Evidence — Turn Integration

**Date:** 2026-10-03. **Scope:** wiring the hallucination mechanism into
the turn so the evaluation matrix (M15.5e) has something real to measure.
Not the matrix itself.

## What landed

- **`HallucinationGuardService`** (`hallucination-guard.service.ts`): the
  post-turn audit. The extraction ledger already carries the turn's mined
  triples, each stamped with the side it came from; the **assistant-sourced**
  ones are the claims the model asserted. For each, it runs the tiered
  `ClaimVerifierService` (deterministic classify, then a verifier for
  high-stakes), turns the findings into a plan with
  `HallucinationMitigationService`, and records the action — carrying the
  candidate id, classification, disagreement, and verifier tier in the
  ledger detail.
  - **User-sourced candidates are ignored** — the model is only answerable
    for its own assertions.
  - **Fail-soft**: any error per candidate is logged and skipped; the audit
    never throws.
- **Turn wiring** (`conversation.service.ts`): the guard runs in the
  post-turn enrichment path, fire-and-forget alongside promotion and persona
  staging. It does not block or fail a turn.
- **DI** (`conversation.module.ts`): the hallucination providers
  (`HallucinationLedgerRepository`, `ClaimConsistencyService`,
  `SystemoneVerifier`, `LlmVerifier`, `ClaimVerifierService`,
  `HallucinationMitigationService`, `HallucinationGuardService`) plus the
  `SYSTEMONE_FETCH` and `VERIFICATION_CLIENT_FACTORY` seams are registered
  in `ConversationModule`, reusing the existing `ClaimRepository` and
  `MemoryDatabaseService` — **no second database connection**.

## Shape decision (recorded)

This is the **audit** shape: detection + verification + a *logged*
mitigation decision, after the reply is produced. It makes the mechanism
live and starts producing real findings + ledger rows for M15.5e. **Blocking
pre-send mitigation** — acting on the reply before it is sent (`refuse`
replaces it, `re_ground` re-answers, `flag` annotates) — is a separate slice,
because it changes the turn contract and needs UX decisions.

## Verification

- **989 unit green** (4 new guard tests): an assistant claim with a
  contradiction finding is mitigated and recorded (`refuse`); user claims
  are ignored; no findings → nothing recorded; a verifier error is
  swallowed (fail-soft).
- **63 e2e green** — the app boots with the new providers; the e2e
  extraction mock emits user-sourced candidates, so the audit is a no-op
  there (unchanged assertions).
- **`tsc` / `eslint` clean.**

## Next

**M15.5e** — the evaluation matrix (detection, FP/FN, secondary model,
mitigation honesty) and a live end-to-end, now that the mechanism runs. The
live check is the point to stand up the Jev sidecar (MLX on the host for
macOS; a CUDA compose service on Linux; CPU fallback).
