# Milestone 15 — Drift Detection

## Objective

M15 makes the persona **self-auditing**. Once ICOS maintains a
curated self-model (M14), it must be able to notice when that model
is contradicted, stale, under pressure, or has semantically moved —
and surface it with severity and provenance rather than silently
absorbing the change.

This is narrow and real, not "personality science." v2 is the
reference: protected/core contradiction, relationship staleness,
repeated candidate pressure, low grounding, and a distributional
measure of semantic movement — with a severity model and a
reconciliation path so alerts do not become self-sustaining noise.

M15 **detects and records**. It does not decide how to respond to a
finding — mitigation is M15.5's job.

### Research question

> Can ICOS detect meaningful identity and relationship drift —
> a candidate contradicting the core or a protected record, a stale
> relationship, sustained pressure toward an unreviewed change, and
> genuine semantic movement of a record — and surface each with an
> honest severity and provenance, without false positives that
> poison grounding or false negatives that let identity slide?

The fundamental flow is:

```text
candidate staged / record updated / grounding checked
    ↓
structural checks  (core + protected + staleness + pressure + score)
    ↓
semantic check     (embedding distance: Wasserstein-1 + entropy)
    ↓
cumulative check   (persistent direction change across cycles)
    ↓
persona_drift_log  (severity · provenance · reviewed/unresolved)
    ↓
grounding + review surface
```

---

# Architectural Boundary

## Drift observes; it does not mutate identity

M15 writes only `persona_drift_log` (append-only) and reads
everything else. It never edits a persona record, never applies a
candidate, and never releases a drift finding on its own — that is
review (M14f) or mitigation (M15.5).

## The core raises the stakes, not the logic

A contradiction against an **immutable core** entry is `critical`
and non-applicable — the same detection path as a protected
evolving record, with the highest severity. The core being immutable
is what makes the finding actionable: the candidate is simply wrong
or the record must be revised, never the core.

## Reconcile, don't accumulate

A finding is **live** while its condition holds and **resolved** when
it stops (v2's lesson: an unresolved low-grounding warning that
never clears makes grounding permanently degraded). Findings are
de-duplicated per `(subject, change_type)` while unresolved.

## Measure, don't claim

Semantic drift uses a real embedding model (the one already in
`~/.icos`) and reports the **Wasserstein-1 / entropy** triad
alongside simpler baselines, so the roadmap's "evaluate Wasserstein
and simpler alternatives" is answered with evidence. No claim of
semantic understanding beyond what the numbers show.

---

# [x] M15a — Failure Modes + Baselines (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15/milestone-15a-evidence-failure-modes.md`.

- [x] Enumerate the observable failure modes: `core_contradiction`,
      `protected_contradiction`, `identity_contradiction`,
      `relationship_state_stale`, `repeated_candidate_pressure`,
      `grounding_score_low`, `semantic_drift`, `cumulative_semantic_drift`
      — each with its detection layer and severity in `persona-drift.ts`.
- [x] Capture the baseline contract: severity is sourced from the
      catalogue (not chosen at detection time), benign baselines are
      declared for the false-positive matrix, and the default thresholds
      live in one place.

# [x] M15b — Structural Drift (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15/milestone-15b-evidence-structural.md`.

- [x] Core and protected-record contradiction, on both explicit target
      conflict and token/negation contradiction; unprotected records
      contradict at `warning`, protected/core at `critical`.
- [x] Relationship staleness beyond a configured freshness window.
- [x] Repeated candidate pressure (a similar-cluster size ≥ the configured
      count).
- [x] Grounding-score-below-threshold, with a deliberate threshold.
- [x] Severity sourced from the M15a catalogue (`notice` is review's;
      detection uses `watch` · `warning` · `critical` · `cumulative`).
- [x] `logOnce` de-duplication on unresolved `(subject, change_type)` and
      `resolve` when the condition clears; pressure reconciled per cluster.

# [x] M15c — Semantic Drift (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15/milestone-15c-evidence-semantic.md`.

- [x] Represent a record's movement with the real embedding model when
      available (RuVector `OnnxEmbedder` behind a fail-closed
      `PersonaEmbedder` boundary); the per-cycle comparison is persisted
      in `persona_drift_trends`. Raw vectors are recomputed per comparison,
      not cached — acceptable at this scale, revisited if profiling wants it.
- [x] Report the triad — cosine (direction), Wasserstein-1
      (`W1 = ½Σ|p−q|`), normalized Shannon entropy — plus the baselines
      (token overlap, edit ratio), all stored per trend row.
- [x] **Compare against simpler baselines** and record which earns its
      place: the embedding cosine is primary when present (it suppresses a
      lexical false positive — disjoint synonyms); the token triad drives
      when embeddings are unavailable.
- [x] Severity weighs the drift signal (base `warning`, escalates to
      `critical` at the critical floor); identical content is a no-op.

# [x] M15d — Cumulative Drift (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15/milestone-15d-evidence-cumulative.md`.

- [x] Trend rows are written per review cycle (M15c); a **cumulative**
      shift (severity `cumulative`, above `critical`) is flagged when a
      record's signal stays at/above the floor for N consecutive cycles.
- [x] Fire once per open streak; the finding carries the cycle evidence
      (review cycles, average signal, floor, required cycles). A cycle
      below the floor breaks the streak and **resolves** the finding, so a
      future streak can fire again.
- [x] The core is exempt by construction — trends exist only for evolving
      records, so a "cumulative" finding about the core is a contradiction
      (M15b), never a trend.

# [ ] M15e — Evaluation + Verification

Evidence: `.reference/plans/evidence/milestone-15/milestone-15e-evidence-verification.md`.

- **Baseline** — every failure mode from M15a is detected at the
      expected severity.
- **False-positive / false-negative** — benign updates do not
      raise alerts; seeded drift is not missed.
- **Reconciliation** — a resolved condition clears its live finding
      and restores grounding.
- **Isolation** — drift writes only the log; no record or core is
      mutated by detection.
- **Live** — a real candidate against a real core/protected record
      produces the expected finding end to end.

---

# Scope Boundary

Keep the following **out of M15**:

- any mitigation or response behavior (M15.5),
- claim/evidence consistency and secondary-model verification
  (M15.5),
- autonomous action policy keyed on drift (M17/M20),
- any mutation of persona records or the core,
- "full semantic personality science" — only measurable signals.

---

# Definition of Done

M15 is complete when ICOS can demonstrate:

> Given a curated persona with an immutable core, ICOS detects
> core/protected contradictions, staleness, sustained pressure, low
> grounding, and genuine semantic movement — assigns each an honest
> severity with provenance, reconciles findings when conditions
> clear, and touches nothing but its own drift log.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/milestone-15/`, plus clean
`tsc` and `eslint`.
