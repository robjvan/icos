# M14f Evidence — Review / Curation

**Date:** 2026-10-02. **Scope:** reviewing a staged persona candidate and
applying it to the evolving tier, with core-conflict refusal. No review UI
(M14g), no full isolation proof (M14h).

## What landed

- **`PersonaReviewService`** (`persona-review.service.ts`): `review(
  candidateId, { outcome, reviewedBy, reason })`.
  - **Outcomes:** `approve_to_identity` (→ `persona_records`),
    `approve_to_user_model` (→ `persona_user_model`),
    `approve_to_relationship` (→ `persona_relationship`), `reject`,
    `archive_as_transient`, `needs_more_evidence`. Non-approval outcomes
    change no store; `needs_more_evidence` leaves the candidate pending.
  - **Every review writes a drift-log entry** (append-only) with the
    outcome as `change_type`, a severity (`info` for approvals; `watch`
    for reject / needs-evidence), the reason, and before/after values.
  - **Protected overwrite:** the review passes the reviewer to the store,
    which refuses a protected overwrite without one; the previous value is
    retained in the record metadata and the drift log.
  - **Core refusal:** before applying any approval, the observation is
    compared to every immutable core entry (`statementsContradict`). On a
    hit, nothing is applied; the candidate is marked
    `conflictsWithCore`, and a `core_contradiction` finding is logged at
    **`critical`**. The result carries `refused: true` +
    `conflictWithCoreEntryId`.
  - **Corrigibility:** `reviewedBy` and `reason` are mandatory (400
    otherwise); a candidate already reviewed is a 409; unknown candidate
    is a 404.
- **Contradiction helper** (`persona-contradiction.ts`): the v2 token +
  negation heuristic, ported and documented as the cheap deterministic
  first pass that M15's structural/semantic drift will extend.
- **Store support:** `PersonaRepository.updateCandidateReview` records
  status/outcome/reason/reviewer/timestamp and merges metadata.
- **API** (`persona.controller.ts`): `GET /core/persona/candidates`
  (pending) and `POST /core/persona/candidates/:id/review`, both
  admin-only; DTO bounds the outcome enum and requires a reason. Never an
  agent tool.

## Verification

- **922 unit green** (10 new): approve→identity applied + logged
  `info`; approve→user-model and →relationship land in their stores;
  reject logs `watch` and changes nothing; `needs_more_evidence` stays
  pending; a core contradiction is **refused** (no record, candidate
  marked, `critical` finding); a protected record is overwritten only via
  review with the previous value retained; re-review → 409, unknown → 404,
  blank reason → 400. Contradiction helper: opposite-polarity overlap
  flagged; restatement / low overlap / too-few-tokens not flagged.
- **59 e2e green.**
- **`tsc` clean.**
- **`eslint` clean.**

## Notes / deferred

- The contradiction check is deliberately conservative; M15 owns
  structural + semantic drift detection proper.
- The review **UI** is **M14g**; the full isolation / tamper-evidence
  proof is **M14h**.
