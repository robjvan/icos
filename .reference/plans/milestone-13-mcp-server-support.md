# Milestone 13 — MCP Server Support

## Objective

M13 makes ICOS an MCP **client**: the platform connects to standard
Model Context Protocol servers (filesystem, fetch, bytestash,
whatever speaks the protocol) and uses their tools inside the
existing agent loop — proposed by the model, gated by approvals,
executed with durable records, observed like any other tool step.
Compared to the bespoke epistemic stack, this is integration work:
the protocol already exists, the loop already exists; M13 is the
honest seam between them.

Direction is fixed: ICOS consumes MCP servers. Exposing ICOS *as*
an MCP server is explicitly out (future work, not this milestone).

### Research question

> Given the closed tool union (`session.search`, `session.rename`),
> can ICOS admit dynamic foreign tools — discovered at runtime,
> namespaced, schema-validated, approval-gated — into planning,
> proposal, execution, and observation, without weakening any
> existing guarantee and without a dead server ever failing a turn?

The fundamental flow is:

```text
configured MCP servers
    ↓
connect + discover (tools/list)
    ↓
bridge into ToolRegistry (namespaced descriptors)
    ↓
agent loop (planning → proposal → approval → execution → observation)
    ↓
durable invocation ledger (existing machinery, unchanged shape)
```

---

# Architectural Boundary

## M8/M9 own the loop

Proposal, validation, approval, execution, observation, budgets,
and termination are M8/M9's. M13 adds tool *sources*, never new
loop mechanics. A foreign tool call is a tool call: same
`requestId`, same approval records, same transcript writes.

## M4 owns evidence

Tool *results* are observations like any other turn content —
extraction may mine them through the normal path. M13 writes no
ledger rows directly and reinterprets nothing.

## The closed union opens — carefully

`ToolName`, `ValidatedToolRequest`, and the executor switch are
closed over two hand-built tools today. M13 introduces exactly one
generic variant (namespaced foreign tools with schema-carried
args), reviewed against every exhaustiveness check in the tree.
Nothing existing changes shape; the union grows by one arm.

## Web-client is out of scope

Same constraint as M10–M12: `core/` and `.reference/` only. Tool
results render through existing transcript paths; any MCP-specific
UI (server list, per-tool toggles) lands later.

---

# [ ] M13a — Client Transport

JSON-RPC client over the two transports standard servers actually
speak: **stdio** (spawned command) and **Streamable HTTP** (URL).
Decision: use the official MCP TypeScript SDK as the transport
client (pinned version) — the protocol handshake, capability
negotiation, and framing are not ICOS's to own or re-derive.
Bespoke JSON-RPC only if the SDK proves unsuitable, recorded with
reasons.

- [ ] Lifecycle per configured server: connect at boot (lazy or
      eager per config), `initialize` + `tools/list` discovery,
      capability record, clean shutdown.
- [ ] Failure semantics: connect failure disables that server
      loudly (health + logs), never bricks boot; mid-run drops
      mark its tools unavailable until reconnect with backoff.
- [ ] Timeouts per call (config), request ids that correlate with
      ICOS `requestId`s in logs.
- [ ] Transport matrix unit-tested against in-process fakes for
      both stdio and HTTP shapes.

# [ ] M13b — Tool Bridging

Foreign tools enter the registry as namespaced descriptors
(`mcp_<server>_<tool>`, sanitized — names are protocol data, never
trusted verbatim).

- [ ] Schema translation: MCP `inputSchema` (JSON Schema) into the
      `ToolDescriptor` args shape the planner consumes. Unknown or
      unbounded schemas fail closed (tool hidden, reason logged) —
      never widened silently.
- [ ] Arg validation against the remote schema before dispatch
      (same `invalid_args` failure code family, new origin noted).
- [ ] Approval policy: **foreign tools require approval by
      default** (conservative; per-server/tool override in config
      only with explicit opt-in, same posture as
      `MEMORY_PROMOTION_AUTO`).
- [ ] Execution path: dispatch through `ToolExecutionService`
      into MCP `tools/call`; result mapping (text blocks → result
      text, `isError` → failure, images/attachments → referenced
      not embedded); server-down mid-call → honest failure, turn
      continues per existing semantics.
- [ ] Secrets: server `env` passthrough (API keys etc.) from
      process env only — never logged, never persisted, never
      returned by any API (same rule as `LLM_API_KEY`).

# [ ] M13c — Agent-Loop Integration

- [ ] Planning descriptors include live foreign tools (name,
      description, args schema) — rebuilt per round like existing
      tools; dead servers' tools simply absent (declared in the
      trace, not silent).
- [ ] Proposal/validation accepts the generic namespaced variant;
      every exhaustiveness check in the loop handles it without a
      fallthrough that could misroute.
- [ ] Observations render foreign results indistinguishably from
      native ones (same transcript shape, same provenance note of
      which server answered).
- [ ] Budgets, approval parks, resumption, and termination behave
      identically — covered by running the existing M9 matrices
      with a foreign tool in the set.

# [ ] M13d — Config + Ops

- [ ] Server catalog: JSON file (default `~/.icos/mcp-servers.json`)
      pointed to by `MCP_SERVERS_PATH`; entries `{ name, transport,
      command | url, args?, env?, enabled?, approval? }`. Validated
      at boot: a bad entry disables that server loudly, never the
      boot. Empty/missing catalog = current behavior exactly.
- [ ] Kill-switches: global `MCP_ENABLED` (default off until
      proven — new capability, conservative default) plus per-server
      `enabled`.
- [ ] Reload semantics: the catalog is frontend-editable (enable /
      disable / add servers), so core re-reads it without a restart
      — explicit reload endpoint (`POST /core/mcp/reload`) plus
      file-watch with debounce; reload diffs the set (connect new,
      drop removed, leave healthy connections alone) and reports
      per-server results.
- [ ] Health reporting: per-server connection state in the health
      surface (connected/disabled/failed + reason).
- [ ] Timeouts and reconnect backoff in config with sane defaults.

# [ ] M13e — Resources and Prompts (trailing slice, may slip)

MCP servers also expose resources (read-only blobs) and prompt
templates. Tools are the milestone; this slice is explicitly
severable — if it slips, M13 closes on a–d + f with resources
recorded as future work.

- [ ] `resources/list` + `resources/read` behind a read-only fetch
      path (no execution semantics, size-capped like skill bodies).
- [ ] `prompts/list` + `prompts/get` as named prompt templates
      available to context construction (no auto-injection).
- [ ] Same approval posture question re-answered for reads
      (default: reads need no approval, writes always do).

# [ ] M13f — Verification

- **Transport matrix** — stdio + HTTP, connect/discover/call,
  drop/reconnect, timeout, malformed server behavior; all against
  fakes, plus one real server (filesystem or fetch) live.
- **Bridging honesty** — hostile names sanitized, unbounded
  schemas fail closed, arg validation rejects before dispatch,
  `isError` maps to failure, secrets never appear in logs/API.
- **Approval gating** — foreign tool proposes → parks → resumes
  exactly like native; default-require proven by attempting with
  no override.
- **Failure isolation** — server killed mid-run: turns continue,
  tools absent from planning, trace declares, ledger untouched.
- **End-to-end turn** — live model + live MCP server (e.g. a file
  read or a bytestash lookup) completing propose → approve →
  execute → observe with the invocation ledger intact.
- **Closed-union review** — every exhaustiveness check audited
  against the new generic arm (grep-verified, listed in evidence).

---

# Scope Boundary

Keep the following **out of M13**:

- exposing ICOS as an MCP server (opposite direction; future),
- new loop mechanics (proposal/approval/execution/observation
  stay M8/M9's),
- resource auto-injection into context (reads are fetched, never
  pushed),
- sampling (servers requesting model completions back — explicit
  non-goal until a trust model exists),
- elicitation passthrough to chat (no new interaction primitives),
- any `web-client/` changes,
- any M4 ledger writes.

---

# Definition of Done

M13 is complete when ICOS can demonstrate:

> Given configured standard MCP servers, the agent discovers their
> tools, proposes them, gets human approval by default, executes
> them with durable records, observes results like native tool
> output, and keeps every turn working when a server dies — while
> no secret leaks, no unbounded schema widens validation, and the
> evidence ledger stays byte-identical.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/`, plus clean `tsc` and
`eslint`. Do not claim M13 complete without this committed evidence.
