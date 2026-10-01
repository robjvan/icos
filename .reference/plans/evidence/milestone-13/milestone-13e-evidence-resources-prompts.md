# M13e Evidence — Resources and Prompts

**Date:** 2026-10-01. **Scope:** read-only `resources/list` +
`resources/read` and `prompts/list` + `prompts/get`, behind lazy
operator-initiated fetches. No auto-injection into model context, no
execution semantics. Both surfaces are optional capabilities, so a
server that does not speak them fails soft.

## What landed

- **Client boundary** (`mcp-client.ts`): added `McpResource`,
  `McpResourceRead`, `McpPrompt`, `McpPromptResult` shapes and four
  methods. Default implementations on the base class refuse with an
  `McpError` — a server (or test double) that lacks the capability
  fails soft, never crashes. `MCP_READ_MAX_CHARS = 12000` (skill-body
  scale) is the read cap.
- **SDK client** (`sdk-mcp-client.ts`): `listResources` /
  `readResource` / `listPrompts` / `getPrompt`, each racing its own
  timeout and mapping failures to `McpError` (transient for
  timeouts/drops) exactly like `callTool`. Pure mappers
  `toResourceRead` / `toPromptResult` (exported, unit-tested):
  - text contents joined + capped (`truncated` flag); blob content
    **flagged `isBinary`, never decoded or embedded**; a mixed
    payload stays readable;
  - prompt messages: text-only kept and capped; non-text or
    unknown-role messages **dropped, never guessed**.
- **Connection manager** (`mcp-connection.service.ts`): lazy
  `listResources` / `readResource` / `listPrompts` / `getPrompt`
  delegating to the connected client; not-connected throws `McpError`.
  Nothing is discovered eagerly (unlike tools) — reads happen only
  when asked.
- **HTTP surface** (`mcp.controller.ts`): `GET
  servers/:name/resources`, `GET servers/:name/resources/read?uri=`,
  `GET servers/:name/prompts`, `POST
  servers/:name/prompts/:prompt {arguments?}`. Error contract:
  unknown server → 404, `McpError` → 502 (new `McpExceptionFilter`),
  bad input → 400.
- **Approval posture re-answered**: reads need **no approval** —
  they are operator-initiated and never reach model context
  automatically; writes (tools) stay approval-gated (M13b).
- **Prompts "available to context construction, no auto-injection"**:
  the service methods are the seam; nothing is injected or proposed
  automatically. (Wiring a UI/command on top is future work.)

## Verification

- **776 unit green** (13 new M13e): `toResourceRead` (join/mime,
  truncation, binary flag, mixed payload, malformed) and
  `toPromptResult` (cap, description, drop unknown-role/non-text,
  malformed); connection delegation (list/read, list/get with args,
  not-connected refusal); `McpExceptionFilter` → 502 mapping.
  **`tsc`/`eslint` clean.**
- **e2e green** (module boots with the extended client boundary).
- **Live** (scratch core :3100), two real servers:
  - **ByteStash (HTTP)** — `GET …/bytestash/resources` → **502**
    `"MCP resources/list failed for \"bytestash\": MCP error -32601:
    Method not found"` (tools-only server fails soft, honestly).
  - **server-everything (stdio via `npx`)** — this also closes the
    **M13f stdio live leg**: connected, 13 tools. `…/resources` → 7
    static docs; `…/resources/read?uri=…architecture.md` → text
    (1604 chars, `isBinary:false`, `mimeType:text/markdown`);
    `…/prompts` → templates incl. `args-prompt`;
    `POST …/prompts/args-prompt {city,state}` → the rendered user
    message. Unknown server → **404**; missing `uri` → **400**; a
    rejected prompt call → **502** with the server's reason (no
    secret leakage).
- **Spec fidelity note**: MCP prompt arguments are `Record<string,
  string>`; the controller enforces strings. `server-everything`'s
  `resource-prompt` is nonstandard (wants an integer `resourceId`) and
  is rejected 400 up front — a correct refusal, not a bug.
