---
name: icos-mcp
description: "The ICOS MCP client (core/src/mcp/): consumes standard Model Context Protocol servers, bridges their tools into the loop, and exposes resources read-only."
version: 1.0.0
author: ICOS
---

# ICOS MCP — External Capability Servers

## Overview

ICOS acts as a **client** to standard MCP servers. Their tools are bridged into
the agent loop (namespaced, approval-gated, durably recorded), and their
resources and prompt templates are exposed read-only. Servers can be added and
the catalog reloaded **without a restart**.

## Status

**Implementation:** Active. M13 (MCP), M19 (dynamic toolsets).

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/mcp/`. **Route:** `/core/mcp`.

## Key Files

- `mcp-client.ts` / `sdk-mcp-client.ts` — the client over the official SDK
  (stdio and HTTP transports).
- `mcp-connection.service.ts` — connect, health, reload.
- `mcp-server-config.ts` — server definitions; spawned servers get a **minimal
  environment allowlist**.
- `mcp-tool-bridge.ts` / `mcp-tool-bridge.service.ts` — bridge server tools into
  the registry.
- `mcp-exception.filter.ts` — failure mapping.
- `mcp.controller.ts` — server CRUD and catalog reload.

## Invariants

- A spawned server receives only the environment variables it explicitly
  references — never the full environment.
- Bridged tools are approval-gated and ledgered exactly like native tools.
- Resources and prompts are read-only surfaces; they never execute.

## Do Not Assume

- Every server is trusted. MCP servers are arbitrary code/infra the operator
  points ICOS at.
- A configured server is healthy. Reachability is reported separately.
