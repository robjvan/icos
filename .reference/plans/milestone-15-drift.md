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

# [ ] M15a — Failure Modes + Baselines

Evidence: `.reference/plans/evidence/milestone-15/milestone-15a-evidence-failure-modes.md`.

- [ ] Enumerate the observable failure modes this milestone
      detects: core/protected contradiction, stale relationship,
      repeated unreviewed pressure, low grounding, semantic
      movement, cumulative direction change.
- [ ] Capture a deterministic baseline fixture set (records +
      candidate sequences) with expected severities, so detection
      is regression-tested, not vibes.

# [ ] M15b — Structural Drift

Evidence: `.reference/plans/evidence/milestone-15/milestone-15b-evidence-structural.md`.

- [ ] Core and protected-record contradiction, on both explicit
      target conflict and token/negation contradiction.
- [ ] Relationship staleness beyond a configured freshness window.
- [ ] Repeated candidate pressure (N similar unreviewed candidates).
- [ ] Grounding-score-below-threshold, with a deliberate threshold.
- [ ] Severity union: `info` · `watch` · `warning` · `critical`.
- [ ] `logOnce` de-duplication on unresolved `(subject, change_type)`
      and `resolve` when the condition clears.

# [ ] M15c — Semantic Drift

Evidence: `.reference/plans/evidence/milestone-15/milestone-15c-evidence-semantic.md`.

- [ ] Represent each record with the real embedding model, persisted
      for reuse.
- [ ] Report the triad: cosine similarity (direction), Wasserstein-1
      (distributional movement, `W1 = ½Σ|p−q|`), normalized Shannon
      entropy (uncertainty), each tagged with provenance.
- [ ] **Compare against simpler baselines** (token overlap, edit
      distance, cosine alone) and record which measure earns its
      place — the roadmap's explicit ask.
- [ ] Severity weighs the drift signal; no semantic drift on
      identical content.

# [ ] M15d — Cumulative Drift

Evidence: `.reference/plans/evidence/milestone-15/milestone-15d-evidence-cumulative.md`.

- [ ] Track a trend row per review cycle; flag a **cumulative** shift
      (a new severity above `critical`) when a record's direction
      moves persistently across N consecutive elevated cycles.
- [ ] Fire once per open streak; carry the cycle evidence in the
      finding.
- [ ] The core is exempt by construction (it cannot move) — a
      cumulative finding about the core is a contradiction, not a
      trend.

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
