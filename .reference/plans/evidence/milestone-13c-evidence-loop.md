# M13c Evidence — Agent-Loop Integration

**Date:** 2026-10-01. **Scope:** foreign tools inside the
existing loop — planning offer, proposal acceptance,
observation rendering, budgets/parks/resumption/termination
with a foreign tool in the set. No new loop mechanics (M8/M9
untouched in behavior); no reload/health (M13d).

## What landed

- **Planning offer** (no loop change needed): both descriptor
  build sites (`prepareTurn`, agent-loop continuation) derive
  `descriptors` + `allowedTools` from `registry.list()` per
  round, so live foreign tools are offered mechanically once
  the M13b bridge is live. The planning block renders them
  with their approval policy
  (`mcp_files_read (pauses for human approval …)`).
- **Dead-server declaration** (the checkbox's "declared, not
  silent"): `ForeignToolSource.unavailableForeign?()` (optional
  seam) → `ToolRegistry.unavailableForeign()` (empty without
  a source or the seam) → `McpToolBridge.unavailableForeign()`
  (every non-connected catalog entry with state + loud
  reason) → `buildPlanningBlock({ unavailable })` renders
  `Unavailable (do not propose):` lines
  (`mcp_files_* (server "files" failed: refused)`). Additive
  optional input — the native loop never declares it.
  Reasons truncated to 120 chars; secrets cannot reach this
  path (catalog carries `$VAR` references, values resolve
  only into the child env at spawn).
- **Proposal acceptance**: validation already admitted the
  generic variant (M13b); the loop passes names through as
  opaque strings (`allowedTools`, `priorActions`,
  `toolCalls`, pairs). One real wart fixed: `renderTurn`
  fell back to a hardcoded `'session.search'` when validation
  carried no request — a foreign proposal would have been
  reported under a native name. Now it reports what the
  model actually proposed, keeping the native literal only
  as the last resort for a missing proposal.
- **Observation rendering**: pairs (`toPairMessages`) and
  `observationFromRecord` are outcome-generic — the
  `McpOutcome` JSON (`{server, tool, text}`) re-enters model
  context as the tool message, provenance included, same
  shape as native results. The transcript still persists
  only user/assistant text (unchanged); the client-facing
  `tool: {invocationId, name}` summary carries the namespaced
  name.
- **Matrix with foreign in the set** (conversation level,
  new `foreign tool turns (M13c)` block, 7 tests): offered
  with policy in planning + `allowedTools`; park under its
  own name with card + zero writes; foreign step chained
  into a text answer with server provenance in the pair;
  granted resume completes the run (`final_answer`,
  `toolSteps: 1`); denial takes the identical terminal path;
  dead servers declared while only natives are offered;
  unvalidated executions named by proposal, never a native
  default.

## Verification

- **750 unit green** (10 new M13c): planning declaration
  present/absent, registry seam default/forward, bridge
  failed+disabled declared / live never declared, 7 loop
  tests above. **48 e2e green** (module boots with the
  extended seam). **`tsc`/`eslint` clean.**
- **Exhaustiveness audit** (all non-spec `session.search` /
  `session.rename` sites): `tool-registry.ts` validate
  dispatches the two literals, everything else falls to
  `validateForeign`; `tool-execution.service.ts` consume
  checks the foreign marker before the rename literal,
  renameInline/search guards exclude the foreign arm;
  `tool-execution.repository.ts` claim guards pair each
  literal with a `foreign in` check; `llm.protocol.ts`
  `ALIASES` stays native-only with foreign passthrough in
  both directions (offer + history); `conversation.service.ts`
  name fallback fixed (above); `agent/` + `planning-context`
  treat names as opaque strings. No fallthrough can misroute
  a foreign call into a native handler.
