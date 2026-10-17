---
name: icos-subagents
description: "The ICOS subagent system (core/src/subagents/): detached child sessions that run a goal with their own budget and return a bounded summary."
version: 1.0.0
author: ICOS
---

# ICOS Subagents — Delegated Child Sessions

## Overview

Subagents let the agent peel work into **isolated child sessions that run
detached from the parent turn**. The parent gets a `task_id` back immediately and
polls; the child runs its own turn loop with a narrowed toolset and its own
budget, then returns a bounded summary. Context isolation is the point.

## Status

**Implementation:** Active. M21 (async-first, flat-only).

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/subagents/`. **Route:** `/core/delegations`.
**Table:** `delegations` in `sessions.db`.

## Key Files

- `subagent-runner.service.ts` — `spawn` writes the record and launches the child
  detached; concurrency cap and per-child budgets; every exit path lands in the
  record.
- `delegation.repository.ts` / `sqlite-delegation.repository.ts` — the delegation
  store.
- `child-turn.port.ts` — the port the runner drives the child loop through.
- `subagent-commands.ts` — the `/agents` command.
- `delegations.controller.ts` — the read API.

## Tools

`delegate_task` (spawn), `delegate_status` (poll), `delegate_cancel`. All
approval `none`. Flat-only: a child calling `delegate_task` gets
`{ spawned: false }`.

## Invariants

- The parent never blocks; the child is fire-and-forget unless polled.
- Approvals are never bypassed — a child's gated calls route through the normal
  path, tagged with the delegation id and goal.
- Memory is shared with provenance (child transcripts extract stamped with the
  child session id), not isolated.
- Restart honestly marks non-terminal rows `failed (restart)`.

## Do Not Assume

- The parent sees the child's work automatically — a completion notice is
  surfaced once, but the shared workspace is the source of truth.
- Children can delegate. They cannot (flat-only).
