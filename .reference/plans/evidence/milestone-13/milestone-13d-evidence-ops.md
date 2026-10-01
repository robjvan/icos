# M13d Evidence — Config + Ops

**Date:** 2026-10-01. **Scope:** catalog (hand-edited),
kill-switches, reload semantics (endpoint + file-watch), health
surface, timeout/reconnect-backoff config. Operator story is
hand-edited catalog + exported env — no frontend CRUD or key
entry (deferred polish slice; see plan Scope Boundary).

## What landed

- **Catalog** (M13a, unchanged shape): JSON file, default
  `~/.icos/mcp-servers.json`, `MCP_SERVERS_PATH` override.
  `resolveCatalogPath()` added so the watcher knows the path
  before the file exists.
- **Kill-switches**: global `MCP_ENABLED` (default off) plus
  per-server `enabled` — both already enforced; reload honors
  them (disabled entries never connect, flips reconcile).
- **Reload** (`McpConnectionService.reload()`): re-reads the
  catalog and reconciles — connects new, disconnects removed,
  re-connects changed, **leaves healthy unchanged connections
  alone** (deep-equality on the entry), rebuilds the bridge
  snapshot, reports `{enabled, path, servers[], errors[]}`.
  Never throws on a bad catalog (parse/validation errors are
  returned, not raised). Off → `{enabled:false,…}` untouched.
  - `POST /core/mcp/reload` (new `McpController`) plus
    `GET /core/mcp/servers` for read-only status. Both
    expose name/transport/state/reason/tool-count only.
  - **File-watch**: `fs.watch` on the catalog's directory,
    250 ms debounce, logs each settle. Directory-not-present is
    reported, not fatal (explicit reload still works).
- **Health** (`buildHealthReport`): new `mcp` section
  `{status, detail, enabled, servers[]}` — `unknown` when
  disabled/unconfigured, `healthy` when all connected/disabled,
  `degraded` with a per-server reason summary when any fail.
  Deliberately does **not** drag the overall report down (MCP is
  additive; a missing optional server is not a broken platform).
  Optional dep, so the `/health` slash command (no MCP manager)
  omits it; `GET /core/health` includes it.
- **Timeouts + backoff**: `MCP_TIMEOUT_MS` (existing) and new
  `MCP_RECONNECT_BACKOFF_MS` (default 10000, `0` disables).
  Failed servers retry in the background at that cadence
  (unref'd timer, cleared on shutdown); retries re-read the live
  set so a removed/recovered server is never reconnected blindly.

## Verification

- **763 unit green** (11 new M13d): config defaults/overrides/
  rejects (backoff `0` valid, `-1` rejected); reload disabled
  no-op; diff (add/remove/leave-healthy/changed/disable);
  parse-error report; **file-watch reload** (write catalog →
  watcher connects the new server); **background retry**
  (fail → connected at backoff); health absent/disabled/
  unconfigured/healthy/failed-section (overall stays healthy).
- **48 e2e green** (module boots + resolves the new controller
  and injected manager). **`tsc`/`eslint` clean.**
- **Live (scratch core :3100, real ByteStash over Streamable
  HTTP):** `GET /core/mcp/servers` → `bytestash connected, 6
  tools`; `GET /core/health` → `mcp healthy "1 connected, 0
  disabled"`, overall healthy. Added a second (LAN-unreachable)
  server + `POST /core/mcp/reload` → `bytestash=connected,
  lan=failed (fetch failed)`, health → `mcp degraded "1 of 2 …"`
  with overall still **healthy**. Removed it on disk → watcher
  logged `MCP catalog reloaded: bytestash=connected` and the
  status dropped back to one server, no restart. Token absent
  from the core log throughout.
