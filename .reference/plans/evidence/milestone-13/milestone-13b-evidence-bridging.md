# M13b Evidence — Tool Bridging

**Date:** 2026-10-01. **Scope:** foreign tools into the
registry as namespaced descriptors, schema translation +
validation, default-require approval, execution path, secrets,
bridge liveness. No loop-behavior changes (M13c), no
reload/health (M13d).

## What landed

- **Naming** (`mcp/mcp-tool-bridge.ts`, pure): `mcp_<server>_<tool>`
  sanitization (lowercase alnum/dash/underscore, 64-char caps,
  lossy by design). Unsanitizable names return null — the tool
  hides, never guessed. `ForeignToolName` is a template literal
  type so native literal narrowing keeps working tree-wide (a
  general `string` arm defeated every `request.name ===`
  discrimination; the third union arm carries a `foreign`
  marker instead).
- **Schema translation** (same file, pure): the boring JSON
  Schema subset (scalar/enum/object/array nodes, bounded depth
  5 / width 50, `additionalProperties: false` closed). `$ref`,
  composition keywords, typeless unknowns, unbounded shapes —
  all fail closed (null = hidden with a logged reason).
  `validateForeignArgs` checks required/unknown/type/enum
  recursively with named failures.
- **Registry delegation** (`tools/tool-registry.ts`): native
  descriptors stay hand-built and frozen; foreign ones serve
  from an optional `FOREIGN_TOOL_SOURCE` (DI token). Without a
  source the registry is exactly the two native tools
  (proven by test). Unknown-to-bridge names fail `unknown_tool`
  (the set moved mid-turn); schema failures fail
  `invalid_args` — same code family, new origin.
- **Approval default-required** (`tools/tool-execution.service.ts`):
  foreign descriptors default `required` (catalog `approval`
  override is explicit opt-in per server). Parking binds **at
  birth**: pure-validate → mint `mcp.execute` approval →
  `register(..., { approvalId })` carries it into the INSERT
  (the ledger's immutability trigger forbids binding
  afterwards — first attempt burned on the UPDATE path).
  Replay converges through register idempotency (no duplicate
  approvals). Grant resumes through a generic
  `claimApprovedTool`/`finishTool` pair mirroring
  claimRename/finishSearch; denial never executes.
  Approval-free foreign tools (explicit `approval: 'none'`)
  execute inline like rename-inline.
- **Execution** (same file): `callTool(server, tool, args)`
  through the connection manager. `isError` → `mcp_failed`,
  throw → `mcp_failed` (message sanitized, never the remote
  text), oversized → `result_too_large` (64 KiB, same bound as
  native). Outcomes persist as a new `McpOutcome` arm and flow
  to the model through the untouched generic final path
  (`JSON.stringify(record.execution)`).
- **Secrets** (plan checkbox, strict reading):
  catalog `env` values must be `"$VAR"`/ `"${VAR}"`
  references — literals rejected at validation, `env` on http
  entries rejected (stdio-only). Values resolve from
  `process.env` at spawn (`resolveServerEnv`), missing/empty
  fails closed before spawning (reason names the variable,
  never any value). Resolved values live only in the child
  env: never logged, never persisted (memory-only entry),
  never in any API (no API exposes entries; `statusOf` is
  name/state/reason/toolCount). `.env.sample` documents the
  export-before-launch contract.
- **Bridge liveness** (`mcp-tool-bridge.service.ts`,
  `mcp-connection.service.ts`): the bridge was spec-only
  (no production caller). Now `OnModuleInit` subscribes +
  snapshots, and the manager notifies a listener set after
  boot init and every reconnect (the M13d reload trigger
  notifies through the same seam). Snapshot rebuilds, never
  deltas — either init order converges. Listener throws are
  logged and swallowed (observers never break the subject).
- **Loop compatibility, no loop changes**: planning already
  builds descriptors + allowedTools from `registry.list()`
  per round, so live foreign tools are offered mechanically;
  `LlmToolCall.name` widened to `string`, provider aliases
  pass foreign names through verbatim (sanitizer contract
  keeps them provider-safe), `ToolOffer.resolve` maps them
  back. Observation/result types admit `McpOutcome`.
  M13c owns provenance rendering + M9 matrices with a
  foreign tool in the set.

## Verification

- **740 unit green** (27 new M13b): naming accept/refuse,
  schema subset + hostile-shape refusal + depth/description
  caps, arg validation naming every failure, bridge
  hide-duplicate/hide-unsanitizable + approval override +
  boot/reconnect rebuild, registry list/lookup/validate
  delegation + closed failures + sourceless native-only,
  park-once/grant-executes-exactly-once/denial/inline/isError/
  oversized, env reference accept-reject + resolve-fail-closed
  (values never in errors), listener notify/unsubscribe/
  throw-isolation. **48 e2e green** (module boots with bridge
  + source wiring). **`tsc`/`eslint` clean.**
- **Closed-union audit** (for M13f): `ToolName` stays the two
  natives; new `ForeignToolName` arm discriminated by
  `foreign in request` at `tool-execution.service.ts`
  (consume, resume, renameInline, search), `tool-registry.ts`
  (validate dispatch), `observation.ts` (result union),
  `conversation.service.ts` (approval card gate lifted from
  rename-only to any bound approval). `grep -rn 'session\.rename'`
  sites that switch on the literal keep the `'foreign' in`
  guard where args narrow.
