---
name: icos-persona
description: "The ICOS persona subsystem (core/src/persona/): an immutable file-backed core, a human-reviewed evolving layer, grounding, and advisory drift detection."
version: 1.0.0
author: ICOS
---

# ICOS Persona — Identity and Drift

## Overview

Identity is two deliberately separated layers: an **immutable core** the software
cannot write, and an **evolving layer** that changes only through human review.
The core is hashed at boot, and by default the runtime **refuses to start** if it
is missing or invalid. Drift detection watches for the agent diverging from its
identity or its knowledge.

## Status

**Implementation:** Active. M14 (persona), M15 (drift). Drift's semantic signal
is **advisory**; the structural checks are deterministic.

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/persona/`. **Database:** `~/.icos/data/persona.db`.
**Route:** `/core/persona`.

## Key Files

- `persona-core.ts` / `persona-core.service.ts` — the immutable core: load, hash,
  fail-closed boot.
- `persona-markdown.ts` — file-backed parsing.
- `persona-candidate-stager.service.ts` / `persona-review.service.ts` — the
  evolving layer and its review queue.
- `persona-grounding.service.ts` — injects the core as a grounding band.
- `persona-drift.ts` / `persona-drift.service.ts` / `persona-contradiction.ts` —
  drift findings.
- `persona-semantic.ts` / `persona-embedder.service.ts` / `persona-similarity.ts`
  — the advisory embedding signal.
- `persona-seed.ts` / `persona-seed-import.service.ts` — seeding.
- `persona.controller.ts` — the read/review API.

## Invariants

- There is no write path to the core; the evolving layer can never contradict it.
- Identity changes are reviewed, never silent.
- The semantic drift signal is advisory and labelled as such — on our corpus it
  tracks topic/tone more than a change in commitment (measured F1 0.78).

## Do Not Assume

- The core is cryptographically signed. It is read-only and tamper-*evident*, not
  tamper-*authenticated* (`core-provenance-integrity.md` is future work).
- Drift is an alarm. It is a signal for a human.
