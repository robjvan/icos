---
name: icos-web
description: "The ICOS web client (web-client/): an Angular SPA with chat, memory, skills, tools, agents, MCP, models, and settings tabs, served over the core API."
version: 1.0.0
author: ICOS
---

# ICOS Web — The Angular Client

## Overview

`web-client/` is the browser UI: a standalone Angular 21 SPA that talks to
`core/` over the same-origin REST + SSE API and a WebSocket realtime channel. It
is a **client only** — every decision lives in `core/`.

## Status

**Implementation:** Active. M20 brought it to parity; M21.2 added the real Agents
tab. Latest release **v0.6**.

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `web-client/src/app/`.

**Build / test / lint:** `npm run build`, `npm test` (`ng test` → vitest),
`npm run lint`.

**Served:** port 4200 (dev via `ng serve`; in compose via nginx).

## Key Files

- `app.routes.ts` — lazy-loaded routes behind `authGuard`; `dashboard-page` is
  the shell, each tab a child route.
- `auth/` — `auth.guard.ts`, `credentials.ts` (session + CSRF).
- `services/` — one thin service per surface: `conversation-stream.service.ts`,
  `session-data.service.ts`, `realtime.service.ts`, `memory-candidate.service.ts`,
  `claim.service.ts`, `memory-review.service.ts`, `persona.service.ts`,
  `skill.service.ts`, `tool.service.ts`, `delegation.service.ts`,
  `mcp-admin.service.ts`, `provider-admin.service.ts`, `secret-admin.service.ts`,
  `cron.service.ts`, `context.service.ts`, `health.service.ts`,
  `attachment.service.ts`, `theme.service.ts`, `core-api.service.ts`.
- `components/` — one directory per tab or panel.

## Tabs (real vs placeholder)

**Real:** Chat (streaming), Memory (review queue, beliefs, ledger, Context
segment), Skills, Tools, Cron, Identity (persona), MCP, Models (providers),
Server settings (secrets + posture), Client settings (theme, health poll, context
target), Agents (M21.2).

**Placeholders** — render a visible "server unimplemented" marker with a
milestone pointer, never fake data: Files, KB, Sensors, Metrics, Comms.

## Invariants

- No client-side source of truth — the client renders what `core/` reports.
- Placeholders say they are placeholders; they never invent data.
- Auth is the session cookie + CSRF double-submit; login over plain HTTP only
  persists on hostname `localhost` (Secure cookies).

## Do Not Assume

- A tab with a route is implemented. Several are honest placeholders.
- The client may hold secrets. Secrets are write-only through `core/`.
