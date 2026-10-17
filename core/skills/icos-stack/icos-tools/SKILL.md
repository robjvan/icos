---
name: icos-tools
description: "The ICOS tool surface (core/src/tools/): the tool registry, approval-aware execution, the durable invocation ledger, and per-turn tool discovery."
version: 1.0.0
author: ICOS
---

# ICOS Tools — Registry, Execution, Ledger, Discovery

## Overview

Tools are how the agent acts. The model **proposes** a call; the runtime
validates it, approves it (if gated), executes it exactly once, and records it.
The catalog is a frozen array — no plugin directory, no dynamic registration — so
every tool flows through the same audited path.

## Status

**Implementation:** Active. M8 (execution), M17 (surface expansion), M19 (MCP
toolsets), M20.7 (tools-out-of-context discovery).

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/tools/`. **Tests:** `core/src/tools/*.spec.ts`.

## Key Files

- `tool-registry.ts` — the `ToolName` union, frozen schemas, argument validators,
  and descriptors (including approval policy).
- `tool-execution.service.ts` — validate → policy → execute; enforces the 64 KB
  result cap; returns `{ ok }` or `{ ok:false, failure:{ code } }`, never throws
  domain errors.
- `tool-execution.repository.ts` — the durable invocation ledger (exactly-once
  claims).
- `tool-policy.ts` — approval-policy resolution.
- `tool-discovery.ts` / `tool-selector.ts` / `tool-surface.service.ts` — per-turn
  injection (always-on core + discovered subset) and the per-session overlay.
- `tool-pull.store.ts` / `tool-rpc.service.ts` / `tool-rpc.controller.ts` —
  `/tools pull` and the `execute_code` tool-RPC bridge.
- `tool-inventory.controller.ts` — `GET /core/tools`.

## Native tools (26)

Files (`read_file`, `search_files`, `write_file`, `patch`), sessions
(`session.search`, `session.rename`), web (`web_search`, `web_extract`), skills
(`skills_list`, `skill_view`, `skill_manage`, `search_platform_tools`), `todo`,
`memory`, `clarify`, `vision_analyze`, `image_generate`, `terminal`,
`process_start` / `process_manage`, `discord` / `discord_admin`, `channel.send`,
`cronjob_manage`, `execute_code`, `browser`, and the delegation trio
(`delegate_task` / `delegate_status` / `delegate_cancel`) — plus everything MCP
servers contribute.

## Hard limits (do not work around silently)

- **One tool call per step** — fan-out fails closed (`invalid_call_count`).
- **Five steps per turn**, then a forced text answer.
- **64 KB** serialized result; **64 KB per call / 256 KB total** wire arguments.
- Identical re-issues are refused (`repeated_call`); a few read tools are
  deliberately exempt.

## Invariants

- Execution is exactly-once; resume observes the ledger row and never re-executes.
- Discovery narrows what the model is *shown*, never what the operator *allows*;
  gated calls still approve normally.
- The durable `invocationId` is used in context, never the model's call id.

## Do Not Assume

- A tool is chainable. Approval-gated tools park and end the chain.
- Fan-out is allowed. It fails closed.
