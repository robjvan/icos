# M13f Evidence — Verification (M13 close)

**Date:** 2026-10-01. **Scope:** the M13f verification matrix across
M13a–e, plus a closed-union audit. Two real gaps were found and
fixed here (drop detection, reason sanitization); the rest was
confirmatory. No new capability beyond making the stated failure
semantics actually true.

## Matrix

- **Transport matrix — stdio + HTTP, connect/discover/call,
  drop/reconnect, timeout, malformed** (all against in-process fakes
  *and* live):
  - `sdk-mcp-client.transport.spec.ts` drives `SdkMcpClient` over an
    in-process JSON-RPC `FakeTransport`: connect + `tools/list`,
    text/isError/attachment mapping, **timeout** (silent method →
    transient `McpError`), **malformed** (structurally odd result →
    empty, no crash), missing capability (JSON-RPC error →
    `McpError`), resources/prompts happy path, and **drop vs.
    intentional disconnect**.
  - Manager specs cover fail-soft multi-server boot, call-failure
    isolation, and **drop detection** (below).
  - Live: **HTTP** ByteStash (connect, 6 tools, read calls) and
    **stdio** `@modelcontextprotocol/server-everything` via `npx`
    (connect, 13 tools). Live **malformed**: a non-MCP URL
    (`https://snippets.exilelogic.ca/`) → `failed` with the
    server's HTTP error, boot unaffected. Live **unreachable**
    (LAN URL) → `failed: fetch failed`. Live **drop/reconnect**:
    `pkill` of the stdio child → `connection lost`, tools dropped,
    backoff retry reconnected (13 tools again) — no restart.
- **Bridging honesty** — hostile names sanitized, unbounded schemas
  hidden, arg validation rejects before dispatch, `isError` →
  failure, secrets never in logs/API (all unit; ByteStash live:
  tools-only server refuses resources with 502 `Method not found`).
- **Approval gating** — live turn: `mcp_bytestash_list_metadata`
  proposed → parked (`mcp.execute`) → approved → resumed →
  observed; default-require with no override (unit + live).
- **Failure isolation** — live: killing a server mid-session drops
  only its tools (planning omits + declares them, `Unavailable`),
  the others keep working, ledger untouched.
- **End-to-end turn** — live model + live MCP server: ByteStash
  propose → approve → execute → observe, reply grounded in live
  data, ledger row `succeeded` with the `mcp` outcome arm.

## Gaps found and fixed (M13f)

- **Drop detection was missing.** M13a promised "mid-run drops mark
  its tools unavailable until reconnect with backoff", but nothing
  listened for a transport close — a killed server stayed
  `connected` until the next call failed. Fixed: `McpClient` gained
  an `onUnavailable` hook; `SdkMcpClient` wires `client.onclose` /
  `onerror` (ignoring intentional closes); the manager marks the
  server `failed: connection lost`, drops its tools, notifies the
  bridge, and schedules the backoff retry. Stale notifications from
  a replaced client are ignored. Unit + live verified.
- **Failure reasons could flood.** A remote server's raw body (e.g.
  an HTML error page) flowed into the reason, logs, and the health
  surface verbatim. Fixed: `sanitizeReason` collapses whitespace and
  caps at 200 chars. Unit + live (malformed server reason now 201
  chars, one line).
- **Watch reliability.** `fs.watch` dropped events under load (a
  real test flake); switched to `fs.watchFile` (poll, 1 s) — a
  config file is tiny and a dropped reload is a real bug. Unit +
  live (edit catalog → reload without restart).

## Closed-union audit (grep-verified)

Every non-spec site that compares a tool name or narrows a validated
request, and how the foreign arm is handled:

- `ToolName` stays the two natives (`tool-registry.ts:8`); the union
  grows by `Omit<ForeignToolCall,…>` carrying a `foreign` marker
  (`tool-registry.ts:25,61-62`).
- **Registry** (`tool-registry.ts`): `validate` dispatches the two
  literals (402/416); everything else falls to `validateForeign`
  (437), which requires `isForeignToolName` + a bridged descriptor
  + `validateForeignArgs` — unknown/unpermitted/invalid fail closed.
- **Executor** (`tool-execution.service.ts`): `consume` checks
  `'foreign' in request` before the `session.rename` literal (122),
  routing foreign to `consumeForeign`; `renameInline` (265),
  `claimRename` path (325), and `search` (439) each exclude the
  foreign arm explicitly; approval gate at 418 admits foreign only
  through parking.
- **Ledger** (`tool-execution.repository.ts`): native claim guards
  (`claimSearch` 263, `claimRename` 470, `claimRenameInline` 514)
  compare literals, so a namespaced name fails closed; foreign
  claim/finish paths pair `'foreign' in` checks (350/395).
- **Provider mapping** (`llm.protocol.ts`): `ALIASES` is native-only;
  `providerAlias` passes foreign names through both directions
  (offer + history) by the sanitizer contract.
- **Names as opaque data**: `agent/`, `planning-context.ts`,
  `conversation.service.ts` treat names as strings (the one hardcoded
  fallback was removed in M13c).
- **No fallthrough** routes a foreign call into a native handler
  (or vice versa); every native path either rejects a foreign name
  or is unreachable for it.

## Gate

`tsc` + `eslint` clean; **785 unit + 48 e2e green** (60 MCP unit
tests). Live legs above. One isolated e2e failure occurred during a
host sleep (socket drop), not reproducible across repeated runs.
