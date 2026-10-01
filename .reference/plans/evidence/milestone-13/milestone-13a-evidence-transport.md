# M13a Evidence — MCP Client Transport

**Date:** 2026-10-01. **Scope:** SDK-backed transport (stdio +
Streamable HTTP), catalog loading, fail-soft connection manager.
No registry bridging (M13b), no loop integration (M13c).

## What landed

- **SDK, pinned** (`@modelcontextprotocol/sdk@1.31.0`,
  save-exact): `Client` + `StdioClientTransport` +
  `StreamableHTTPClientTransport` behind the owned `McpClient`
  boundary (connect/discover/call, ICOS-shaped `McpError` with
  transient flags). Per-call timeouts race server responses —
  never trust a foreign server with the event loop. Result
  mapping is text-first (attachments referenced by MIME, never
  embedded). No bespoke protocol code; the plan's SDK decision
  stands unmodified.
- **Catalog** (`mcp-server-config.ts`): JSON file (default
  `~/.icos/mcp-servers.json`), dns-like names, per-transport
  required fields, `enabled`/`approval`/`env` options. Invalid
  entries and duplicate names are reported and skipped — one bad
  server never blocks the rest. Absent file = empty catalog
  (current behavior exactly); unparseable file = reported, never
  a boot failure.
- **Manager** (`McpConnectionService`): boot via `OnModuleInit`
  (no-op when `MCP_ENABLED=false`, the default), per-server
  fail-soft connect (failed → `failed` + reason, disabled stays
  `disabled`), discovery + calls for the bridging slice,
  lazy explicit `reconnect()`, status snapshot for health,
  clean shutdown. Wired in `ConversationModule` (factory +
  service providers).
- **Config**: `MCP_ENABLED` (false), `MCP_SERVERS_PATH` (empty →
  default), `MCP_TIMEOUT_MS` (30000), `.env.sample` documented.

## Verification

- **713 unit green** (incl. 12 new MCP tests): catalog accept /
  reject-per-entry / duplicates / missing / unparseable files;
  disabled-by-default darkness; fail-soft multi-server boot;
  discovery + call flow; down/missing server typed errors;
  reconnect retry; call-failure isolation (server stays
  connected).
- **48 e2e green** (module boots with the new providers).
- **`tsc`/`eslint` clean.**
