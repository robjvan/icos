---
name: icos-memory
description: "The ICOS epistemic memory subsystem (core/src/memory/): candidate extraction, provenance, promotion to beliefs, ranked recall, dynamics, and contradiction handling."
version: 1.0.0
author: ICOS
---

# ICOS Memory — Candidate Extraction & Epistemic Memory

## Overview

Memory in ICOS is layered and provenance-first. Each completed turn feeds an
extraction pass that emits **candidates**; human-reviewed **promotion** turns
candidates into **beliefs (claims)**; **recall** ranks and injects them into
context; **dynamics** (reinforcement, decay, revision, retirement) let beliefs
evolve. Everything is evidence-traceable, and nothing is rewritten silently.

## Status

**Implementation:** Active — M10–M12 complete (extraction since M4).

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/memory/`.

**Databases:** `~/.icos/data/memories.db` (candidates, claims, history,
promotions) and `~/.icos/data/claims-vector.db` (derived vector index).

**Tests:** `core/src/memory/*.spec.ts`.

## Key Files

- `memory-candidate.ts` — the `MemoryCandidate` shape and its kind enum.
- `extraction.prompt.ts` — the extractor system prompt.
- `memory-candidate-extractor.ts` / `llm-memory-candidate-extractor.ts` — the
  extractor interface and its OpenAI-compatible implementation (a **separate**
  `MEMORY_LLM_*` endpoint).
- `candidate-validation.ts` — deterministic gates (fields, ranges, enums,
  lengths, in-result dedupe).
- `sqlite-memory-candidate.repository.ts` — candidate-ledger persistence.
- `claim.ts` / `sqlite-claim.repository.ts` / `claim-history.ts` — beliefs and
  their walkable revision history.
- `promotion.ts` / `promotion.service.ts` — candidate → belief promotion.
- `recall.service.ts` / `associative-recall.ts` / `ranking.ts` /
  `query-shaping.ts` / `prompt-bands.ts` — turn-time retrieval and
  band-separated context.
- `maintenance.ts` / `maintenance.service.ts` — dynamics (decay, revision,
  retirement).
- `ruvector-claim-index.ts` / `sqlite-lexical-claim-index.ts` — semantic and
  lexical claim indexes.
- `kb-bridge.ts` — the knowledge-base bridge (M23 stewardship is future work).

## Responsibilities

- Observe each completed turn via a **separate** extraction model and emit
  structured candidates with mandatory provenance (`sessionId + messageId`).
- Validate deterministically and fail in isolation — extraction never breaks the
  conversation.
- Promote reviewed candidates to beliefs, keeping a walkable revision history.
- Rank and inject relevant beliefs at turn time, honestly separated from user
  speech.
- Let beliefs evolve (reinforce, decay, revise, retire) without silent rewrites.

It is **not** responsible for:

- Deciding on its own what becomes durable knowledge — promotion is human-gated.
- Erasing derived memory when a session is deleted (that is a separate, explicit
  operation).

## Invariants

- Provenance is mandatory — no candidate without `sessionId + messageId`.
- Candidates are observations, not commitments; scores are observations, not
  calibrations.
- Duplicates are stored, not merged; contradictions are preserved side by side.
- The evidence ledger is retained forever; the vector index is *derived* and
  rebuildable — never design a candidate→vector migration.
- Greeting/chatter → zero candidates is correct behaviour.

## Do Not Assume

- A candidate is knowledge. It is evidence awaiting review.
- Memory is deleted with its session. Derived memory survives session deletion by
  design.
- Scores are calibrated. The extractor hands out confidence freely.
- Memory lives in a separate service. It is hosted in `core/src/memory/`.
