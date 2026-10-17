---
name: icos-skills
description: "The ICOS skill catalog system (core/src/skills/): how SKILL.md packs are discovered, validated, selected, and injected into context."
version: 1.0.0
author: ICOS
---

# ICOS Skills — The Catalog System

## Overview

Skills are versioned markdown instruction packs the agent can pull into context.
Discovery is deterministic (keyword, no embeddings); loading is fail-closed;
activation scopes a skill to a session or a single turn. This skill describes the
**system** — the skills themselves live under `core/skills/` (see `icos-stack`).

## Status

**Implementation:** Active. M7 (skills), M18 (library adoption).

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/skills/`. **Catalog:**
`core/skills/<category>/<name>/SKILL.md`. **Route:** `/core/skills`.

## The format contract

- A **skill** is a directory containing `SKILL.md` with `---` front-matter.
  Required: `name` (kebab-case, **must equal the directory name**) and
  `description` (≤500 chars). `version` is optional. Unknown keys are tolerated.
- A **category** is a directory containing `DESCRIPTION.md` — convention only,
  never parsed by code.
- The scanner walks up to four levels; a directory without `SKILL.md` is not a
  skill. Malformed files are **skipped with a reason**, never crash the load.

## Key Files

- `skill-loader.ts` — `parseSkillFile` / `scanSkillDir` / `loadSkillBody`; the
  format contract and the skip reasons.
- `skill-discovery.ts` — pure, deterministic keyword ranking (name hits outrank
  description hits).
- `skill-selector.ts` — budget-governed per-turn selection.
- `skill.service.ts` — catalog refresh, activation (`/skills use`), one-shot
  staging.
- `skill-seed.service.ts` — seeding from the bundled catalog.
- `command-adapter.ts` — the `/skills` command surface.
- `skills.controller.ts` — the management API.

## Invariants

- Discovery never reads bodies and never mutates state; same input ⇒ same output.
- The catalog is validated fail-closed at load; skips are reported, not hidden.

## Do Not Assume

- A skill in the folder loads. It must have valid front-matter and a matching
  directory name.
- A `DESCRIPTION.md` is a skill. It is a category description.
