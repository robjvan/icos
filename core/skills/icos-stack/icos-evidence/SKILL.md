---
name: icos-evidence
description: "ICOS evidence standards: what counts as a verified claim, what an evidence file must contain, and how to validate one before checking off a milestone."
version: 1.0.0
author: ICOS
---

# ICOS Evidence — Claim Nothing Without It

## Overview

In ICOS a milestone is complete only when verification evidence is committed.
This skill defines the evidence contract, the validation procedure, and the
honesty norms every evidence file follows. It is the operational form of the rule
in `AGENTS.md`.

## Status

**Implementation:** Active — evidence has been required for every milestone since M1.

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Evidence:** `.reference/plans/evidence/` — per-milestone subdirectories, plus
older flat files (`milestone-2-evidence-streaming.md`, …).

**Plans:** `.reference/plans/` (open) and `.reference/plans/closed/` (complete).

**Roadmap / status:** `.reference/plans/full-roadmap-extended.md`,
`.reference/status.md`.

**Governing rule:** `AGENTS.md`.

## Evidence Contract

Every evidence file opens with `> Status: **verified** (YYYY-MM-DD)` and contains,
in order:

1. **Design** — what was built and the decisions behind it.
2. **Unit** — the unit-test result (counts, and what is new); `tsc`/`eslint` clean.
3. **E2E** — the end-to-end result (counts, and what is new).
4. **Live run** — the real software against a real provider/database, with the
   exact commands and verbatim observations (raw JSON, raw SSE), never summaries.
5. **Verdict** — what is proved, naming the plan clause satisfied.
6. **Remainder** — what was *not* verified and why, as open checklists rather than
   tribal knowledge.

Negative proofs (isolation boundaries that must *not* happen) matter as much as
positive ones, and are proven rather than asserted.

## Validation Procedure

1. No evidence file → unconfirmed, whatever the code or logs suggest.
2. Missing commands, missing counts, or a missing regression statement → reject.
3. Secrets discipline: key values redacted; error bodies carry tag + status +
   snippet only.
4. The verdict must match the body; a partial pass is only a pass for the rows
   actually verified.
5. Honesty artifacts are preserved, not cleaned up: flakes, debugging footnotes,
   contention/timeout observations, operational notes.

## Do Not Assume

- A passing test suite alone equals a verified claim. Only the committed file
  confirms it.
- A plan existing, or most tasks being checked, is completion.
- Local-provider success proves cloud rows.
- A code change is live on any other host.

## Related

- `icos-core`, `icos-memory` — the subsystems whose claims this skill validates.
