# M15.5d Evidence — Mitigation Strategies

**Date:** 2026-10-03. **Scope:** deciding what ICOS does with a
hallucination finding, and recording it. No turn-path wiring yet.

## What landed

- **`HallucinationMitigationService`** (`hallucination-mitigation.service.ts`):
  - `posture()` — the effective strategy per severity (defaults merged with
    any config override).
  - `plan(findings)` — the **strictest** strategy across the findings, with
    the finding that drove it and the reasons.
  - `record(plan, context?)` — appends the action to the ledger; a `none`
    strategy is not a mitigation and is not logged.
- **Explicit strategies**: `none` · `flag` · `re_ground` · `defer` ·
  `refuse`. `re_ground` (retrieve and re-answer) is *executed at turn time*
  — this layer decides and logs, so it stays pure and testable; the
  retrieval/LLM step is the caller's.
- **Conservative default posture**: `critical` → `refuse`, `warning` →
  `flag`, `watch` → `flag`, `info` → `none`. Never present an unresolvable
  or contradicted claim as settled, and never rewrite silently.
- **Append-only ledger**: `hallucination_mitigations` (memories DB) with a
  repository (`record` / `list` / `ping`). One row per action, carrying the
  severity, strategy, failure mode, reason, subject, and detail JSON.

## Verification

- **985 unit green** (9 new): the service does nothing with no findings;
  refuses a `critical` finding and flags `watch`/`warning` by default;
  takes the strictest strategy across findings; honours a posture override
  while unspecified severities keep their defaults; records a non-`none`
  mitigation with its finding and skips `none`. The ledger records and
  lists entries with finding + detail, persists across reopen, and answers
  its liveness probe.
- **`tsc` / `eslint` clean.**

## Config / env

`HALLUCINATION_MITIGATE_INFO` · `_WATCH` · `_WARNING` · `_CRITICAL`
(`none | flag | re_ground | defer | refuse`), documented in `.env.sample`.

## Deferred

- **Turn-path wiring**: nothing invokes `plan`/`record` at turn time yet;
  the live end-to-end (a fabricated claim caught and mitigated) is
  **M15.5e**.
- **Live Jev verification**: the systemone verifier has a real contract
  (pinned from the `jev-style` repo); proving it against a running local
  model is deferred until the sidecar is set up.
