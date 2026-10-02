# M14d Evidence — Grounding Check + Context Band

**Date:** 2026-10-02. **Scope:** persona grounding evaluation, the
provenance-tagged prompt band, and its injection into context
construction. No review application (M14f), no UI (M14g).

## What landed

- **`PersonaGroundingService`** (`persona-grounding.service.ts`):
  - `evaluate(userId)`: `coreLoaded`, `identityGrounded`, `userKnown`,
    `relationshipCurrent`, counts, `overallScore`, `needsWarmup`,
    `details`. Core is a **hard gate** (absent → score capped at 0.2).
    Weights: 0.4 core + 0.2 strong-identity (confidence ≥ 0.75) + 0.2
    curated user facts + 0.2 fresh relationship (≤ 48 h). Warm-up
    threshold 0.6 — deliberate, not v2's aggressive `score < 1`.
  - `build(userId)`: core entries first (immutable), then evolving
    records + user facts sorted protected → confidence → recency, under
    an entry limit **and** a character budget, with a `truncated` flag.
    At least one entry (the core frame) is always kept.
  - `band(userId)`: the prompt band, or **null** on a miss; **fail-soft**
    (a grounding error logs and yields null, never fails a turn).
- **Band render** (`<persona_grounding ...>`): a labelled system block
  with per-entry provenance attributes (`layer`, `category`,
  `confidence`, `source`, `updated`, `immutable`/`protected`), the
  relationship state, and an explicit truncation notice. The header
  states these are curated identity, not user speech.
- **Context construction**: `ContextMemory` gains an optional
  `personaBand`; `buildContext` emits it as its own system message
  **ahead of** the memory band. Absent/null → byte-identical pre-M14
  context.
- **Turn wiring**: `ConversationService.prepareTurn` computes the band
  per turn (single-user `DEFAULT_PERSONA_USER_ID`) and merges it into the
  bands handed to `buildContext`. `ConversationModule` imports
  `PersonaModule`.
- **API**: `GET /core/persona/grounding` (admin-only) returns
  `{ result, bundle }`.
- **Config / env**: `PERSONA_GROUNDING_ENTRY_LIMIT` (12),
  `PERSONA_GROUNDING_CHARACTER_BUDGET` (6000), documented in
  `.env.sample`.

## Verification

- **906 unit green** (6 new): ungrounded → `needsWarmup` + null band;
  fully grounded with core + identity + user + fresh relationship →
  score 1, band carries `immutable=true` and user content; stale
  relationship lowers the score to 0.8; core entries sort first and are
  marked immutable; entry-limit truncation; context builder places the
  persona band before the memory band.
- **59 e2e green.** The e2e app has no authored core and no persona
  records, so the band is null and the assembled messages stay
  **byte-identical** — the existing exact-message assertions pass
  unchanged. This is the intended "bandless on a miss" property.
- **`tsc` clean.**
- **`eslint` clean** across `{src,test}/**/*.ts`.

## Deferred

Applying a staged candidate to a record, protected-overwrite semantics,
and core-conflict refusal are **M14f**. The review UI is **M14g**. The
full isolation/tamper proof is **M14h**.
