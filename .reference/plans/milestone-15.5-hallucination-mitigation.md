# Milestone 15.5 — Hallucination Mitigation

> Inserted between M15 and M16 without renumbering the roadmap.
> Numeric suffix is deliberate: this is the second half of what the
> roadmap bundled as "drift detection and hallucination mitigation,"
> split because it is a distinct research question with distinct
> dependencies.

## Objective

M15 asks whether ICOS can detect **identity drift**. M15.5 asks a
different question: whether ICOS can detect and mitigate an
**unsupported or contradicted output** — a claim the model asserts
that its own evidence does not support, or that the store already
contradicts.

This is not identity-specific. It uses the epistemic evidence
ledger (M10) and, where stakes justify it, a **second model** to
check the first. Mitigation is explicit and observable — flag,
re-ground, defer, or refuse — never silent rewriting.

### Research question

> Given claims with provenance and evidence (M10), can ICOS detect
> when an output is unsupported by its evidence or contradicted by
> the store, and mitigate it through deterministic checks plus
> optional secondary-model verification — without suppressing
> legitimate novelty or turning every uncertainty into a refusal?

The fundamental flow is:

```text
model output / claim
    ↓
evidence lookup (M10 provenance)
    ↓
consistency check  (supported? contradicted? merely novel?)
    ↓
[optional] secondary-model verification (S4 provider registry)
    ↓
finding (severity + provenance)
    ↓
mitigation: flag · re-ground · defer · refuse   (explicit, logged)
```

---

# Architectural Boundary

## Detection here, mitigation there

Identity drift detection (M15) and claim consistency (M15.5) share
a shape but not a subject. M15 is about the curated self-model;
M15.5 is about assertions in a turn. They meet at the finding
surface, not the storage.

## Evidence is the arbiter, not the model

A claim is "supported" only if the evidence ledger backs it. The
model's confidence is not evidence. This keeps the check
deterministic and auditable, with the model reduced to a proposer.

## Secondary verification is optional and provider-agnostic

A second model is a verification *input*, never the authority, and
is selected through the existing provider registry (S4) — no
hard-coded provider. If no second model is configured, M15.5 still
functions on deterministic checks alone.

## No silent rewriting

Mitigation never edits user-visible output behind the scenes. It
flags, re-grounds, defers, or refuses — and records why. Silent
correction is exactly the untraceable behavior this project exists
to avoid.

---

# [x] M15.5a — Failure Modes + Baselines (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5a-evidence-failure-modes.md`.

- [x] Defined the observable failure modes in `hallucination-modes.ts`:
      `unsupported_claim`, `contradicted_claim`, `fabricated_provenance`,
      `overconfident_uncertainty`, `silent_self_correction`, and
      `unverifiable_high_stakes` — each with its detection layer and
      severity.
- [x] Baseline contract: severity is sourced from the catalogue (not chosen
      at detection time); benign baselines declared (novelty, supported
      claims, honest hedging, recorded model disagreement); default
      thresholds documented. The deterministic layer owns every mode but
      `unverifiable_high_stakes` (secondary model).

# [x] M15.5b — Claim / Evidence Consistency (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5b-evidence-consistency.md`.

- [x] For an assertion, resolve the store via M10 provenance and classify:
      `supported` · `contradicted` · `novel`. Deterministic only — no model
      judgment.
- [x] Failure modes detected here: `unsupported_claim` (novel),
      `contradicted_claim` (opposing active claim),
      `overconfident_uncertainty` (high asserted confidence on no support),
      and `fabricated_provenance` (a cited claim id that does not exist).
- [x] Novelty is not failure — an unsupported-but-uncontradicted assertion
      is flagged (`warning`), never refused.

# [x] M15.5c — Secondary-Model Verification (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5c-evidence-secondary.md`.

- [x] A second model verifies high-stakes claims, provider-agnostic and
      tiered (preferred first): a **systemone decision model**
      (`POST /v1/systemone` — local Jev-style or any Jev-compatible
      server), then an **OpenAI-compatible LLM** named by provider id via
      the S4 registry, then **none**.
- [x] Disagreement is **recorded** (the verdict + a `disagreement` flag),
      never auto-resolved; every verdict records its tier and
      **independence** (`independent` vs `self`).
- [x] Absent a configured verifier, the milestone still passes on
      deterministic checks; a high-stakes unresolved assertion is flagged
      `unverifiable_high_stakes`.

# [x] M15.5d — Mitigation Strategies (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5d-evidence-mitigation.md`.

- [x] Explicit mitigations: `flag`, `re_ground` (retrieve and re-answer),
      `defer` (ask/review), `refuse` — plus `none`.
- [x] Each mitigation is logged with the finding that triggered it in an
      append-only `hallucination_mitigations` ledger — no silent behavior.
- [x] Configurable posture per severity with conservative defaults
      (`critical` → `refuse`, `warning`/`watch` → `flag`, `info` → `none`);
      the strictest strategy across findings wins.

# [x] M15.5e0 — Turn Integration (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5e-wiring-evidence.md`.

- [x] The mechanism is wired into the turn: the post-turn enrichment audit
      checks the model's own asserted claims (assistant-sourced extracted
      triples) through the tiered verifier and turns findings into a logged
      mitigation. Fire-and-forget and fail-soft, exactly like extraction and
      promotion. (Blocking pre-send mitigation is a separate later slice.)
- [x] All hallucination providers (ledger, classifier, both verifiers, the
      tiered composition, mitigation, guard) are registered in
      `ConversationModule`, sharing the existing `ClaimRepository` and
      `MemoryDatabaseService` — no second database connection.

# [x] M15.5e — Evaluation + Verification (complete 2026-10-03)

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5e-evidence-verification.md`.

- [x] **Detection** — each failure mode from M15.5a produces the
      expected finding (matrix spec; severity from the catalogue).
- [x] **False-positive / false-negative** — legitimate novelty is not
      refused; supported claims pass; fabricated claims are caught.
- [x] **Secondary model** — disagreement is surfaced, not hidden; the
      system works without a verifier configured.
- [x] **Mitigation honesty** — every mitigation is logged and
      observable (`GET /core/hallucination/mitigations`); no output is
      silently rewritten.
- [x] **Live** — a real turn with a contradicted assistant claim is caught,
      refused, and logged end to end, with the tier recorded (`decision`,
      the real Jev 2B).

---

# Scope Boundary

Keep the following **out of M15.5**:

- identity/relationship drift (M15),
- autonomous action gating (M17/M20),
- hard, system-level safety enforcement — M15.5 is detection and
      mitigation of claims, not the sole safety mechanism,
- any silent rewriting of model output.

---

# Definition of Done

M15.5 is complete when ICOS can demonstrate:

> Given claims with evidence provenance, ICOS detects unsupported
> and contradicted outputs, optionally verifies high-stakes claims
> with a second provider-agnostic model, and mitigates through
> explicit, logged actions — without suppressing legitimate novelty
> and without ever rewriting output silently.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/milestone-15.5/`, plus clean
`tsc` and `eslint`.
