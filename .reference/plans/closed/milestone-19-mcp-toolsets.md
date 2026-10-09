# M19 — Dynamic MCP Server toolsets

> Status: **planned** (2026-10-09; decisions confirmed). Client side only: ICOS
> **connects to** configured MCP servers and **auto-generates a toolset from each
> server's discovered tools** — ICOS is not itself exposed as an MCP server.
> Related: **M13** (the MCP client this extends), **M17a** (the toolset policy
> layer this plugs into).

## Objective

Give every configured MCP server a generated `mcp-<server>` toolset populated
from its discovered tools, make the bare server name an alias for that toolset,
guarantee the generated toolset **composes with** (never shadows) a built-in
toolset of the same name, and route generated toolsets through the existing
toolset selection (`TOOLS_ENABLED_TOOLSETS` / `TOOLS_DISABLED_TOOLSETS`,
per-session policy).

No hand-coded wrapper per MCP tool — tools are discovered and bridged at
runtime.

## What already exists (do not rebuild)

The MCP **client** subsystem is complete and wired end-to-end
(`core/src/mcp/`):

- **Catalog** (`mcp-server-config.ts`): JSON at `~/.icos/mcp-servers.json`
  (override `MCP_SERVERS_PATH`), entries `{name, transport, command/args|url,
  env/headers, enabled, approval}`, secrets only as `$VAR`/`secret:` refs.
- **Connection manager** (`mcp-connection.service.ts`): connects at boot
  (fail-soft), discovers tools, drops on error, backoff reconnect, file-watch
  reload, secret-rotation reconnect, health reporting.
- **Client** (`sdk-mcp-client.ts`): official SDK, per-call timeout, strict env
  allowlist.
- **Bridge** (`mcp-tool-bridge.service.ts` + `mcp-tool-bridge.ts`): implements
  the registry's `ForeignToolSource`; names tools `mcp_<server>_<tool>`,
  translates JSON Schema, applies the per-server `approval` policy.
- **Registry seam** (`tool-registry.ts`): `list()` appends foreign descriptors;
  `lookup()`/`validate()` handle them; dispatch routes to the right server
  (`tool-execution.service.ts` → `McpConnectionService.callTool`).
- **Policy** (`tool-policy.ts`): `resolveToolPolicy` over `toolset`/`name`.

**The one gap:** every bridged tool is pooled under the single hardcoded
`toolset: 'mcp'` (`tool-registry.ts:2446` and `:2476`). There is no
`mcp-<server>` toolset, no bare-name alias, and nothing preventing a
server-named `browser`/`web` from colliding with the built-in toolset.

## Decisions

> Confirmed with the operator 2026-10-09 (aggregate `mcp` alias kept; MCP
> offer stays opt-out).

1. **Generated toolset name:** `mcp-<server>` (e.g. `mcp-github`). Dash, matching
   the Hermes convention and the existing catalog name charset.
2. **Bare-name alias:** selecting `github` resolves to the `mcp-github` toolset.
3. **Aggregate alias:** `mcp` resolves to *all* `mcp-<server>` toolsets — keeps
   today's `mcp` behaviour working after the rename.
4. **Composition, not replacement:** aliases are **additive**. A selector matches
   its literal toolset(s) *and* any aliased toolsets, so selecting `browser`
   enables the built-in `browser` toolset **and** `mcp-browser`; neither shadows
   the other. Selecting `mcp-browser` enables only the server's tools.
5. **Per-tool overrides still win:** `TOOLS_ENABLED` / `TOOLS_DISABLED` (by tool
   name) remain the escape hatch for a shared-name collision — e.g.
   `TOOLS_DISABLED=browser` disables only the built-in `browser` tool.
6. **Default policy unchanged (opt-out):** MCP tools are offered unless
   `TOOLS_ENABLED_TOOLSETS` is set. (Context-flood mitigation is a separate
   concern; see Risks.)

## Design

### 1. Foreign descriptors carry their toolset

`ForeignToolSource.listForeign()` currently drops the owning server. Extend the
projection (`tool-registry.ts:362-384`) so the registry does not have to parse
names:

```ts
export interface ForeignToolSource {
  listForeign(): readonly {
    readonly name: string;
    readonly server: string;      // NEW
    readonly toolset: string;     // NEW  (e.g. 'mcp-github')
    readonly description: string;
    readonly approval: ApprovalPolicy;
    readonly argsSchema: ToolDescriptor['argsSchema'];
  }[];
  lookupForeign(name: string):
    | { name; server; tool; toolset; description; approval; argsSchema }  // + toolset
    | undefined;
  unavailableForeign?(): readonly UnavailableForeignServer[];
  toolsetAliases?(): Readonly<Record<string, readonly string[]>>;         // NEW
}
```

Registry uses the supplied toolset instead of the hardcoded `'mcp'`:

```ts
// list() and foreignSourceDescriptor()
toolset: descriptor.toolset ?? 'mcp',
```

`mcp-tool-bridge.ts` gains `toolsetFor(server) => \`mcp-${server}\`` (pure,
unit-testable), and the bridge fills `server`/`toolset` on every descriptor.

### 2. Toolset aliases

The bridge derives the alias map from the connected servers:

```ts
toolsetAliases() {
  const aliases: Record<string, string[]> = {};
  const all: string[] = [];
  for (const d of this.listForeign()) {
    aliases[d.server] = [d.toolset];   // github -> [mcp-github]
    all.push(d.toolset);
  }
  aliases['mcp'] = all;                // mcp -> every mcp-<server>
  return aliases;
}
```

`ToolRegistry.toolsetAliases()` delegates to the optional seam (empty without
one).

### 3. Alias-aware policy resolution

`ToolPolicyConfig` gains `toolsetAliases?: Readonly<Record<string, readonly string[]>>`.
`resolveToolPolicy` expands each selector set once, then does membership as
before:

```ts
const expand = (selectors: readonly string[]): Set<string> => {
  const out = new Set<string>();
  for (const s of selectors) {
    out.add(s);
    for (const t of aliases[s] ?? []) out.add(t);
  }
  return out;
};
const onSet = expand(enabledToolsets);
const offSet = expand(disabledToolsets);
let on = onSet.size === 0 || onSet.has(descriptor.toolset);
if (offSet.has(descriptor.toolset)) on = false;
if (disabledTools.has(descriptor.name)) on = false;
if (enabledTools.has(descriptor.name)) on = true;
```

Composition is automatic: `browser` → `{browser, mcp-browser}`, so both
toolsets match. A `web`-named server behaves identically.

### 4. Wiring

`ConversationService.resolveTools()` (`conversation.service.ts:1668-1699`)
merges the registry aliases into the policy config:

```ts
resolveToolPolicy(this.registry.list(), {
  ...this.toolPolicyConfig(),
  toolsetAliases: this.registry.toolsetAliases(),
});
```

### 5. Operator surface

- `/core/mcp/servers` response gains the generated `toolset` per server (so the
  operator can see `github → mcp-github`).
- `.env.sample`: document that `TOOLS_ENABLED_TOOLSETS` / `TOOLS_DISABLED_TOOLSETS`
  accept `mcp-<server>` and the bare server name, and that a server named after
  a built-in toolset composes rather than shadows.

## Live verification target (M19.4)

ByteStash MCP server (`http://192.168.2.10:5000/mcp`, Streamable HTTP, API-key
auth). Verified against the code:

- ICOS speaks the **Streamable HTTP** transport
  (`StreamableHTTPClientTransport`, `sdk-mcp-client.ts:3`). ✅
- The catalog `url` is a **literal** (not a reference) → the entry carries
  `http://192.168.2.10:5000/mcp` directly.
- `env_file: ./core/.env` is wired, so `$BYTESTASH_AUTH` resolves in-container;
  `MCP_ENABLED=true` and `MCP_SERVERS_PATH` are already set.
- `BYTESTASH_AUTH` holds the raw key, and ByteStash accepts `x-api-key`, so the
  entry uses `"x-api-key": "$BYTESTASH_AUTH"` (no scheme prefix needed).

```jsonc
{
  "name": "bytestash",
  "transport": "http",
  "url": "http://192.168.2.10:5000/mcp",
  "headers": { "x-api-key": "$BYTESTASH_AUTH" },
  "approval": "required"
}
```

ByteStash exposes six tools (`list_snippets`, `get_snippet`, `create_snippet`,
`update_snippet`, `delete_snippet`, `list_metadata`), so the target is a
`mcp-bytestash` toolset with those tools. M19.4 also exercises the vault path
(`secret:`) alongside `$VAR`.

## Slices

- **M19.1 — Descriptor toolset.** Extend the `ForeignToolSource` projection;
  bridge sets `mcp-<server>`; registry emits it. Unit: naming + registry.
- **M19.2 — Aliases + composition.** `toolsetAliases` seam; alias-aware
  `resolveToolPolicy`; conversation wiring. Unit: policy matrix.
- **M19.3 — Surface + docs.** `/core/mcp/servers` toolset field; `.env.sample`;
  a short note in `docs/`.
- **M19.4 — Verification.** E2E with the in-process fake MCP transport (already
  exists in `sdk-mcp-client.transport.spec.ts`) + a live run against a tiny
  local stdio MCP server.

## Verification plan

- **Unit**
  - `tool-policy.spec.ts`: alias expansion; `browser` composes built-in +
    `mcp-browser`; `mcp` matches all; `mcp-<server>` matches only its server;
    per-tool override beats a toolset disable.
  - `mcp-tool-bridge.spec.ts` / `.service.spec.ts`: `toolsetFor`; descriptors
    carry `server`/`toolset`; `toolsetAliases` shape.
  - `tool-registry.spec.ts`: `list()` emits `mcp-<server>`; `lookupForeign`
    toolset.
- **E2E / live**
  - Configure a local stdio MCP server (a tiny committed Node fixture that
    speaks MCP over stdio — offline and deterministic; avoids `npx` at test
    time), enable `MCP_ENABLED=true`, and assert: tools appear under
    `mcp-<server>`, the bare name selects them, and a server named `browser`
    composes with the built-in toolset.
  - Live: `PUT /core/mcp/servers/<name>` → `/core/mcp/servers` shows
    `toolset: mcp-<name>`; a conversation turn with
    `TOOLS_ENABLED_TOOLSETS=<name>` offers the server's tools.

## Risks / open questions

- **Rename is a behaviour change.** Anyone relying on `TOOLS_*_TOOLSETS=mcp`
  keeps working via the aggregate `mcp` alias; document it.
- **Context flood.** N servers × M tools can be a large tool list. The toolset
  mechanism lets the operator restrict; a future opt-in default (or per-server
  enable) is out of scope for M19.
- **Tool-name collisions across servers** are already impossible
  (`mcp_<server>_<tool>`), so no change needed.
- **`approval: 'none'` + `execute_code`.** Unchanged by M19, but worth noting:
  an approval-free MCP tool is reachable from inside `execute_code` (existing
  behaviour).
- **Deferral:** not warranted. The client, bridge, dispatch, and policy all
  exist; the change is confined to the registry projection, the bridge, and
  `resolveToolPolicy` (~4 files + tests).
