---
name: icos-core
description: "The ICOS runtime service (core/): conversation loop, streaming, sessions, provider boundary, commands, approvals, clarifications, tools, subagents, and security."
version: 1.0.0
author: ICOS
---

# ICOS Core — The Runtime Service

## Overview

`core/` is the ICOS runtime: a NestJS 11 / TypeScript service that owns the
agent loop and everything the agent does. The web client (`web-client/`) is the
UI; the other subsystems in this skill set are hosted *inside* `core/`.

## Status

**Implementation:** Active. M1–M21 complete; latest release **v0.6**.

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/` — entrypoint `core/src/main.ts` (binds `config.port`,
default 3000).

**Tests:** `core/src/**/*.spec.ts` (unit, co-located) and `core/test/*.e2e-spec.ts`.

**Configuration:** `core/.env.sample` is the authoritative reference; `core/.env`
is local-only and gitignored. `LLM_MODEL` is required (fail-fast at boot).

**Databases:** `~/.icos/data/` — `sessions.db`, `memories.db`, `persona.db`,
`channels.db`, `claims-vector.db`.

## Key Subsystems (`core/src/`)

- `conversation/` — the turn loop (`conversation.service.ts`: `converse`,
  `converseStream`, `resume`), context building and budgeting
  (`context.builder.ts`, `context-budget.service.ts`,
  `context-compaction.service.ts`), and the session / claims / recall controllers.
- `llm/` — the provider-agnostic boundary (`llm.client.ts`, `llm-provider.ts`,
  `llm.protocol.ts`). One OpenAI-compatible contract; no provider branches
  anywhere else.
- `session/` — SQLite stores and migrations for transcripts, sessions, and todos.
- `agent/` — the bounded plan → act → observe orchestration loop.
- `tools/` — the tool registry, execution service, and the durable invocation
  ledger.
- `skills/` — the skill catalog.
- `memory/` — the epistemic memory subsystem (see `icos-memory`).
- `persona/` — identity layers and drift.
- `mcp/` — the MCP client and dynamic toolsets.
- `channels/` — Discord + email.
- `subagents/` — detached child-session delegation.
- `approvals/`, `clarifications/` — the structured interaction primitives.
- `commands/` — the deterministic slash-command layer.
- `security/`, `auth/`, `secrets/`, `providers/` — exposure, authentication, the
  secret vault, and the provider catalog.
- `cron/`, `realtime/`, `attachments/`, `vision/`, `image/`, `browser/`,
  `process/`, `hallucination/`, `health/`.

## Interfaces (HTTP, prefix `core/`)

- **Conversation:** `POST /core/conversation`, `POST /core/conversation/stream`
  (SSE `meta → token* → done | error`), `GET /core/conversation/:id`.
- **Sessions:** `GET /core/sessions`, `GET /core/sessions/search?q=`.
- **Memory:** `/core/memory-candidates`, `/core/claims`, `/core/recall`,
  `/core/promotions`, `/core/maintenance`.
- **Interactions:** `/core/approvals`, `/core/clarifications`.
- **Capabilities:** `/core/tools`, `/core/skills`, `/core/mcp`, `/core/cron`,
  `/core/channels`, `/core/delegations`, `/core/attachments`.
- **Governance:** `/core/persona`, `/core/security`, `/core/secrets`,
  `/core/providers`, `/core/hallucination`.
- **Health:** `GET /core/health/live` (public liveness); `GET /core/health`
  (full report, authenticated).

## Invariants

- Three paths stay distinct: `/command` → core action; conversation → LLM;
  pending interaction → resolve by id. They never collapse into one pipeline.
- Commands never reach the LLM; LLM text never resolves interactions;
  interactions never write message rows.
- No fake assistant messages, no silent side effects; transcript rows are never
  deleted (`/undo` flags, `/fork` copies).
- Provider switching is env/catalog-only — the loop contains zero provider
  branches.
- Secrets flow only into request headers; never logged, persisted, or returned.

## Do Not Assume

- There are `apps/*` sub-projects. The runtime is `core/`; the UI is `web-client/`.
- `packages/contracts` exists. It does not; the event-bus boundary is planned.
- Separate `epistemic-memory` or `model-sentinel` apps exist. Memory and drift
  live in `core/src/memory/` and `core/src/persona/`.
- Port 3000 is the only instance. Isolated verification boots use other ports
  with temporary databases.
- `localhost` inside the container reaches your host. Use `host.docker.internal`.
