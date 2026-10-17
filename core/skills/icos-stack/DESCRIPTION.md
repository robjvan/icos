---
description: Orientation and reference skills for the ICOS v3 stack itself — its services, subsystems, and evidence process. Use these to understand how ICOS is built before changing it.
---

# ICOS Stack — Development Workspace

> **Type:** Orientation / Reference (category)
> **Scope:** The ICOS v3 development repository and its stack-reference skills.
> **Purpose:** Give an agent a correct mental model of ICOS before it touches the code.
> **Description:** ICOS v3 is a from-scratch cognitive-agent runtime: a NestJS
> service (`core/`) plus an Angular web client (`web-client/`). This category is
> the entry point for skills that describe the stack to itself.

## Status

**Implementation:** Active development — M1–M21 complete; latest release **v0.6**.

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

**Current focus:**

- Closing the v1.0 exit criteria in `.reference/notes/release-1.0-exit-criteria.md`.
- Preserving explicit subsystem ownership, evidence, and traceability as the stack grows.

## Location

**Repository root:** `~/src/ExileResearch/icos-v3/` (this checkout).

**Governing documents:**

- `AGENTS.md` — the contributor contract (branch, evidence, honesty, secrets rules).
- `README.md` — what ICOS is and why.
- `ARCHITECTURE.md` — how each part works, and whether it is verified.
- `.reference/status.md` — the live status rollup.
- `.reference/plans/full-roadmap-extended.md` — the M1→M40 roadmap.

## Knowledge Map

**Services**

- `icos-core/SKILL.md` — the runtime service (conversation, sessions, tools, …).
- `icos-web/SKILL.md` — the Angular client.

**Subsystems**

- `icos-memory/SKILL.md` — epistemic memory (candidates → beliefs → recall).
- `icos-persona/SKILL.md` — identity layers and drift.
- `icos-tools/SKILL.md` — tool registry, execution ledger, discovery.
- `icos-skills/SKILL.md` — the skill catalog system.
- `icos-mcp/SKILL.md` — MCP client and toolsets.
- `icos-channels/SKILL.md` — Discord + email.
- `icos-subagents/SKILL.md` — delegated child sessions.

**Cross-cutting**

- `icos-security/SKILL.md` — auth, secret vault, provider catalog, exposure.
- `icos-evidence/SKILL.md` — evidence standards and the validation procedure.
- `icos-deploy/SKILL.md` — running the stack (compose, `bin/`, data dir).

**Behavioral**

- `persona-anchor/SKILL.md` — re-anchor to the persona core and re-ground claims
  openly when drift or hallucination is detected.

## Responsibilities

This category is responsible for:

- Establishing that **v3 is the development target**, and that v2 (ISABEL)
  behaviour is not evidence about v3.
- Routing work to the owning service, subsystem, or skill.
- Preserving the boundaries between core, memory, persona, tools, channels,
  security, and evidence.

It is **not** responsible for:

- Replacing subsystem-level docs, contracts, or source-level documentation.

## Related

- `icos-evidence` — decides whether a v3 claim is confirmed.

## Do Not Assume

- A file in this repository is live on any other host.
- A v2 (ISABEL) behaviour has a v3 equivalent, or vice versa.
- The stack has `apps/*` sub-projects — the runtime is `core/`, the UI is `web-client/`.
- Any Hermes-agent implementation is part of ICOS (it contributed skill files and
  inspiration only).
