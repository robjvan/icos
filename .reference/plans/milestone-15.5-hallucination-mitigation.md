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

# [ ] M15.5a — Failure Modes + Baselines

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5a-evidence-failure-modes.md`.

- [ ] Define observable hallucination failure modes: unsupported
      claim, contradicted claim, fabricated provenance, overconfident
      uncertainty, silent self-correction.
- [ ] Baseline fixture set with expected findings and severities.

# [ ] M15.5b — Claim / Evidence Consistency

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5b-evidence-consistency.md`.

- [ ] For a claim, resolve its evidence via M10 provenance and
      classify: supported · contradicted · novel (unsupported but not
      contradicted).
- [ ] Deterministic checks only; no model judgment required.
- [ ] Novelty is not failure — output that is new is flagged, not
      refused.

# [ ] M15.5c — Secondary-Model Verification

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5c-evidence-secondary.md`.

- [ ] A second model verifies high-stakes claims via the S4 provider
      registry; provider-agnostic, no hard-coding.
- [ ] Disagreement between models is recorded as a finding, not
      auto-resolved.
- [ ] Absent a configured verifier, the milestone still passes on
      deterministic checks.

# [ ] M15.5d — Mitigation Strategies

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5d-evidence-mitigation.md`.

- [ ] Explicit mitigations: flag, re-ground (retrieve and re-answer),
      defer (ask/review), refuse.
- [ ] Each mitigation is logged with the finding that triggered it —
      no silent behavior.
- [ ] Configurable posture per severity; conservative defaults.

# [ ] M15.5e — Evaluation + Verification

Evidence: `.reference/plans/evidence/milestone-15.5/milestone-15.5e-evidence-verification.md`.

- **Detection** — each failure mode from M15.5a produces the
      expected finding.
- **False-positive / false-negative** — legitimate novelty is not
      refused; supported claims pass; fabricated claims are caught.
- **Secondary model** — disagreement is surfaced, not hidden; the
      system works without a verifier configured.
- **Mitigation honesty** — every mitigation is logged and
      observable; no output is silently rewritten.
- **Live** — a real turn with a fabricated claim is caught and
      mitigated end to end.

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
