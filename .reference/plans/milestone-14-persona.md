# Milestone 14 — Persistent Persona Maintenance

## Objective

M14 gives ICOS a durable, curated **persona**: who it is, who it is
working with, and what the current relationship is — grounded at
session start, not improvised from whatever memory retrieved first.

The persona has **two tiers**:

- an **immutable core** — the constitution that defines an ICOS
  agent (ethical grounding, core beliefs, safety boundaries,
  non-negotiables, shared agentic character). The agent cannot
  change this. Neither can a compromised memory store, a bug, or
  the review pipeline. Only a human editing a file can.
- an **evolving persona** — beliefs, values, facts, preferences,
  and relationship state that grow over time through explicit,
  recorded review.

This is the v2 Coherence Engine's job — "it knows who it is" —
rebuilt as one in-process module over ICOS's single SQLite store,
with the event spine, cross-service hops, and n-gram embedding
shortcuts left behind. Identity is **isolated from memory**: memory
extraction may propose, but only review writes persona, and only a
human edits the core.

### Research question

> Given an epistemic memory that extracts, contradicts, decays, and
> revises freely (M10–M12), can ICOS maintain a curated self-model
> that is (a) isolated from every memory write, (b) anchored to an
> immutable core the running system cannot alter, (c) changed only
> through explicit review, and (d) able to answer "am I grounded?"
> at session start — without duplicating the memory system and
> without letting identity decay like a belief?

The fundamental flow is:

```text
session turn
    ↓
memory extraction (M4/M10) — proposes identity-relevant observations
    ↓
persona candidate staging (stage only — never writes identity)
    ↓
review (human, admin-only) → evolving persona record + drift log
    ↓
session-start grounding band: [immutable core] + [evolving, provenance-tagged]
    ↓
context builder (M11) → model
```

---

# Architectural Boundary

## Memory extracts; persona adjudicates

M10–M12 remain the memory system: they remember, contradict,
reinforce, decay, and revise. M14 owns the **subset that belongs to
the self-model and relationship model**. A memory claim can *stage*
a persona candidate; it can never write a persona record. This
boundary is load-bearing and must not blur.

## Two tiers, one direction of authority

The **core** outranks the **evolving** tier, which outranks
candidates. Authority only flows downward. Nothing the agent does
can promote a candidate into the core.

## Identity is isolated from memory

Persona lives in its **own SQLite database file**, separate from the
memory stores at the filesystem level as well as the table level. The
invariant to prove: **if a memory store is tampered with, no persona
record and no core entry changes.** Memory has no write handle to
persona; the reverse is not required (persona may cite memory
provenance by plain column, never a cross-database foreign key).

## The core has no write path — by construction

The core is not a DB row the application can `UPDATE`. It is a
file, loaded read-only at boot, hash-pinned. There is **no API, no
tool, no service method, and no migration** that writes it. The
strongest form binds the core directory read-only into the container
so even a fully compromised `core` process cannot write it.

## Dedicated review, not the generic approval lifecycle

Decided 2026-10-02. Persona review needs richer outcomes than the
M6 approval lifecycle (which record layer does this land in?),
and it must never be reachable as a tool call. It is its own
admin-only subsystem with its own audit trail.

## Web-client is in scope (this milestone)

Unlike M10–M13, M14 ships a review surface. A human-curated model
with no human review UI is not credible. Scope is one persona tab
(core shown read-only, evolving records, pending candidates, drift
history, review actions) — not a redesign of the client.

## Legacy reference

v2 sources are inputs, not architecture — see
`.reference/legacy/coherence-engine/` (`identity-engine.md`,
`ce-implementation-plan.md`, `ce-gap-bridge-plan.md`,
`ce-phase-4-verification.md`, `code/README.md`). Deliberate deltas:
no RabbitMQ / cross-service events; real embeddings instead of
character n-grams; the immutable core is **new and stronger** than
v2's "protected anchors"; the portable JSON package importer is
deferred.

---

# [x] M14a — Persona Model + Stores (complete 2026-10-02)

Evidence: `.reference/plans/evidence/milestone-14/milestone-14a-evidence-model.md`.

- [x] New `core/src/persona/` module. `persona.repository.ts` over
      `better-sqlite3`, in its own `persona.db` file (separate from the
      `sessions` and `memories` files), mirroring the proven v2
      repository shape.
- [x] Tables: `persona_records` (identity/self layer),
      `persona_user_model`, `persona_relationship` (singleton),
      `persona_candidates`, `persona_drift_log`.
- [x] Provenance on every row: `source`, `source_turn_id`,
      `claim_id` (nullable link into M10 claims), `confidence`,
      `sensitivity`, `protected`, `reviewed_by`, timestamps,
      `metadata_json`.
- [x] Deterministic sha256-prefixed IDs so staging is idempotent.
- [x] `protected` here means "explicit review required to
      overwrite" (evolving tier only; the core is not a DB row);
      enforced at the store.
- [x] Migration-safe schema creation; new tables never touch
      existing M1–M13 tables. Verified: the persona file contains
      only persona tables.

# [x] M14b — Immutable Core Persona (complete 2026-10-02)

Evidence: `.reference/plans/evidence/milestone-14/milestone-14b-evidence-core.md`.

- [x] Core is **file-backed**: `PERSONA_CORE_PATH` (default
      `~/.icos/persona/core.md`), parsed read-only at boot; a shipped
      template lives at `core/persona/core.example.md`.
- [x] Categories: `ethical_grounding`, `core_belief`,
      `safety_boundary`, `non_negotiable`, `agentic_character`.
- [x] **No write path exists.** Proven: no file-write call anywhere in
      the persona subsystem, no mutation of core entries, no API/tool
      that changes it — only `readFileSync`. Read-only-mount guidance
      documented in `.env.sample`.
- [x] Boot computes and records the core sha256; a hash change is an
      audited human act (`persona_core_changed`, severity `info`), not
      drift.
- [x] Missing or invalid core → **fail-closed boot** by default
      (`PERSONA_CORE_REQUIRED=true`): ICOS refuses to start rather than
      run half-grounded, since drift and hallucination checks need a
      reference frame. `false` is the documented dev/throwaway escape
      hatch. `loaded: false` + reason is still surfaced when not
      required; identity is never fabricated.
- [x] Core is exposed read-only (status + `GET /core/persona/core`,
      admin-only); entries carry a literal `immutable: true`. Band
      ordering lands in M14d.
- [x] Core entries expose stable ids + content so a candidate
      contradicting one is `critical` and non-applicable (enforcement
      lands in M14f).

# [ ] M14c — Seed Import (Evolving Baseline)

Evidence: `.reference/plans/evidence/milestone-14/milestone-14c-evidence-seed.md`.

- [ ] Markdown section→policy parser (port of the v2 seed importer):
      headings map to category / sensitivity / protected / layer.
- [ ] Guarded seed root (`PERSONA_SEED_ROOT`): relative paths only,
      `realpath` containment, `.md` only, bounded file count.
- [ ] Idempotent by content hash; unchanged imports write nothing
      and emit nothing.
- [ ] Unresolved template placeholders are skipped, never persisted.
- [ ] A changed seed updates only its own untouched `seeded`
      baseline; anything else is **staged as a candidate**, never an
      overwrite.
- [ ] The import target is the **evolving tier only**. The core is
      never a seed target.
- [ ] Deferred (recorded, not built): portable JSON package import.

# [ ] M14d — Grounding Check + Context Band

Evidence: `.reference/plans/evidence/milestone-14/milestone-14d-evidence-grounding.md`.

- [ ] Grounding result: `coreLoaded`, `identityGrounded`,
      `userKnown`, `relationshipCurrent`, `overallScore`,
      `needsWarmup`, `details`. Core is a **hard gate**; the
      remaining weights are deliberate, not `score < 1`.
- [ ] Grounding bundle: core entries first (immutable), then
      evolving (protected-first, then confidence, then recency),
      under an entry limit **and** a character budget, with an
      explicit truncation notice.
- [ ] Rendered as a labelled, provenance-tagged band
      (`<persona_grounding>`), injected by the M11 context builder
      as its **own band** — never mixed with memory bands.
- [ ] Status + inspection endpoint.
- [ ] Empty/weak persona returns `needsWarmup: true`, never a fake
      identity.

# [ ] M14e — Candidate Staging

Evidence: `.reference/plans/evidence/milestone-14/milestone-14e-evidence-candidates.md`.

- [ ] Memory extraction (M4/M10) may stage identity-relevant
      observations as `persona_candidates`. **Stage only.**
- [ ] Candidate fields: observation, category, confidence,
      proposed target layer, `source`, `source_turn_id`, `claim_id`,
      `session_id`.
- [ ] Idempotent by deterministic ID; re-observing the same claim
      does not duplicate.
- [ ] No code path from extraction to a persona record except
      through review.

# [ ] M14f — Review / Curation

Evidence: `.reference/plans/evidence/milestone-14/milestone-14f-evidence-review.md`.

- [ ] Outcomes: `approve_to_identity`, `approve_to_user_model`,
      `approve_to_relationship`, `reject`, `archive_as_transient`,
      `needs_more_evidence`.
- [ ] Every review writes a `persona_drift_log` entry (append-only).
- [ ] `protected` evolving records require explicit review to
      overwrite; previous value retained in the log.
- [ ] A core-contradicting candidate **cannot be applied** by any
      outcome; review surfaces the conflict and refuses.
- [ ] Corrigibility rule encoded: revision improves truth and
      continuity; it is not identity failure.
- [ ] Review is admin-only (reuses M6/S2 auth + roles); it is never
      exposed as an agent tool.

# [ ] M14g — Web-Client Persona Review

Evidence: `.reference/plans/evidence/milestone-14/milestone-14g-evidence-ui.md`.

- [ ] Persona tab: core (read-only, with its recorded hash),
      evolving records, pending candidates (provenance +
      confidence), and drift history.
- [ ] Review actions wired to M14f; core rows render read-only, no
      affordance to edit them.
- [ ] Traceability: one screen answers "why does ICOS believe this,
      and when did it change?"

# [ ] M14h — Verification

Evidence: `.reference/plans/evidence/milestone-14/milestone-14h-evidence-verification.md`.

- **Core immutability** — attempt every write path (API, service,
      tool, migration, review): all fail; core hash changes only
      when a human edits the file.
- **Isolation** — tamper with memory stores; assert zero persona /
      core change.
- **Grounding** — empty store → `needsWarmup`; seeded store →
      grounded; core always present and first.
- **Seed** — idempotence, path-escape rejection, changed-seed
      conflict staging.
- **Review** — each outcome mutates the right layer and logs;
      protected overwrite blocked; core conflict refused.
- **End-to-end** — live model turn carries the persona band;
      review a candidate; restart persists.

---

# Scope Boundary

Keep the following **out of M14**:

- semantic / distributional drift detection (M15),
- hallucination and claim/evidence mitigation (M15.5),
- mood-aware autonomous action policy (M17/M20),
- portable JSON package import (deferred; documented),
- multi-user identity scoping beyond the existing single-user
      model (kept as a seam, not built),
- any change to M10–M12 memory semantics.

---

# Definition of Done

M14 is complete when ICOS can demonstrate:

> A running ICOS carries an immutable core it cannot alter, an
> evolving self/user/relationship model that changes only through
> reviewed candidates, grounding injected at session start as its
> own provenance-tagged band, and full isolation such that tampering
> with memory cannot change identity and tampering with anything
> cannot change the core — with every persona change answerable in
> one place.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/milestone-14/`, plus clean
`tsc` and `eslint`. Do not claim M14 complete without this committed
evidence.
