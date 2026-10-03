# M15b Evidence — Structural Drift

**Date:** 2026-10-03. **Scope:** structural drift detection, de-duplication,
and reconciliation. Semantic (M15c) and cumulative (M15d) are out.

## What landed

- **`PersonaDriftService`** (`persona-drift.service.ts`) — observes only;
  it writes `persona_drift_log` and reads everything else.
  - `evaluateCandidate(candidate)`: core contradiction (`critical`),
    protected-record contradiction (`critical`), identity-record
    contradiction (`warning`), and repeated-candidate pressure (`watch`).
    The explicit-target case is honoured in addition to token/negation
    contradiction.
  - `auditGrounding(userId)`: relationship staleness (`watch`) and
    grounding-score-below-threshold (`warning`), **reconciling** findings
    whose conditions have cleared.
  - `logOnce` de-duplicates per unresolved `(subject, change_type)`;
    severity always comes from the M15a catalogue.
  - Pressure uses the largest mutually-similar cluster
    (`tokenOverlap`, Jaccard) vs the configured count; reconciliation
    resolves a category's finding when its cluster falls below threshold.
- **`persona-similarity.ts`**: `contentTokens` + `tokenOverlap` — the
  baseline lexical measure M15c will report alongside embeddings.
- **Repository**: `hasUnresolvedDrift` and `resolveDrift` (marking
  `reviewed = 1`), the two primitives `logOnce`/reconcile need.
- **Wiring**: the M14e stager now evaluates each staged candidate
  (fail-soft — a drift error never blocks staging). `PersonaGroundingService`
  reads the freshness window and warm-up threshold from config so grounding
  and drift agree.
- **Config / env**: `PERSONA_RELATIONSHIP_FRESH_HOURS` (48),
  `PERSONA_GROUNDING_WARMUP_THRESHOLD` (0.6),
  `PERSONA_CANDIDATE_PRESSURE_COUNT` (3),
  `PERSONA_CANDIDATE_PRESSURE_SIMILARITY` (0.6).
- **API**: `POST /core/persona/drift/audit` (admin-only) runs the
  grounding/relationship audit and returns newly raised findings.

## Verification

- **934 unit green** (9 new: 5 catalogue + 4 drift service): core
  contradiction at `critical`, raised once, and **no identity written by
  detection**; protected → `critical` vs identity → `warning`; pressure
  only at the threshold (2 silent, 3 raises `watch` with the count);
  staleness + low grounding raised together, then **resolved** after the
  conditions clear (zero unresolved remain).
- **63 e2e green** (app + persona). The persona e2e now also sees the
  structural finding raised at staging for a core-contradicting candidate;
  no existing assertion changes.
- **`tsc` / `eslint` clean.**

## Deferred

- **M15c** — semantic drift (embeddings + Wasserstein/entropy vs baselines).
- **M15d** — cumulative drift across review cycles.
- **M15e** — the false-positive/false-negative matrix, UI audit button,
  and milestone verification.
