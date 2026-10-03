# M14e Evidence — Candidate Staging

**Date:** 2026-10-02. **Scope:** the adapter from memory extraction to
the persona review queue. Stage only; no review application (M14f), no UI
(M14g).

## What landed

- **`PersonaCandidateStager`** (`persona-candidate-stager.service.ts`):
  reads `MemoryCandidate[]` (M4) and writes `persona_candidates` rows.
  - **Classifier (narrow, documented):** `preference` → user-model queue;
    `relationship` → relationship queue; `fact`/`observation`/`goal`/
    `decision` **whose subject names the agent** → identity queue.
    Everything else is ignored. The agent-subject alias set is a
    conservative constant; a false positive only sits in review.
  - **Provenance:** every staged row carries `source: 'memory-extraction'`,
    `sessionId`, `sourceTurnId` (message id), `confidence`, and metadata
    (`memoryCandidateId`, kind, subject/predicate/object, negated,
    sourceRole, extractorModel). `claimId` is null for now — staging is
    from the M4 ledger, not from M10 claims; the column is reserved.
  - **Idempotent:** the candidate id is deterministic over
    `userId:observation` (the rendered triple), so re-observing the same
    triple does not duplicate, and the store's upsert preserves a
    candidate's `status` — a reviewed candidate is not resurrected.
  - **Stage only:** it depends on `PersonaRepository` and never calls
    `createRecord` / `upsertUserFact` / `upsertRelationship`. There is no
    path from extraction to a persona record except through review.
- **Turn wiring** (`conversation.service.ts`): after extraction saves
  candidates and proposes promotion, the stager runs **fire-and-forget and
  fail-soft** — a staging error is logged and dropped; a turn is never
  affected. `ConversationModule` already imports `PersonaModule`.

## Verification

- **912 unit green** (6 new): preference → user-model queue with
  provenance; relationship → relationship queue; agent-subject fact →
  identity while a non-agent fact is skipped; non-identity kinds ignored;
  idempotence across repeated staging; negation rendered (`not X`) and no
  persona record / user fact written.
- **59 e2e green** (the extraction mock's preference candidates now stage
  into the persona DB too; no assertion depends on that, and the exact
  message-assembly assertions are unaffected). One cold-start run of the
  e2e suite flaked once and did not reproduce across four subsequent runs
  — noted, not attributable to M14e (which touches a separate DB file).
- **`tsc` clean.**
- **`eslint` clean.**

## Deferred

Applying a staged candidate to a record, protected-overwrite semantics,
and core-conflict refusal are **M14f**. Staging from **M10 claims** (with
`claim_id` provenance) is a future extension. The review UI is **M14g**.
