# Milestone 19 — Dynamic MCP Server toolsets

**Status:** complete.

Each configured MCP server's discovered tools now surface as a generated
`mcp-<server>` toolset, with the bare server name as an alias, the `mcp`
aggregate alias, and composition with built-in toolsets (no shadowing). Client
side only — ICOS is not itself exposed as an MCP server.

## Slices

| Slice | Summary | Evidence |
| --- | --- | --- |
| M19.0 | ByteStash smoke test (existing client: connect/discover/call) | [m19.0-bytestash-smoke-evidence.md](m19.0-bytestash-smoke-evidence.md) |
| M19.1 | Foreign descriptors carry a generated toolset (`mcp-<server>`) | `core/src/tools/tool-registry.spec.ts`, `core/src/mcp/mcp-tool-bridge*.spec.ts` |
| M19.2 | Toolset aliases + additive composition in `resolveToolPolicy` | `core/src/tools/tool-policy.spec.ts`, `core/src/conversation/conversation.service.spec.ts` |
| M19.3 | Surface the generated toolset (`GET /core/mcp/servers`) + docs | `core/.env.sample` |
| M19.4 | Live verification (ByteStash) | [m19.4-live-evidence.md](m19.4-live-evidence.md) |

## Final state

- Bridged MCP tools carry `toolset: mcp-<server>` (was a hardcoded `mcp`).
- `toolsetAliases`: bare server name → `mcp-<server>`; `mcp` → every generated
  toolset; additive, so a server named after a built-in toolset composes.
- Generated toolsets work through the existing selection
  (`TOOLS_ENABLED_TOOLSETS` / `TOOLS_DISABLED_TOOLSETS`); per-tool overrides
  still win.
- `GET /core/mcp/servers` reports each server's generated `toolset`.
- Live: ByteStash connects (6 tools, `mcp-bytestash`); the bare-name alias
  selects it; a `browser`-named server composes with the built-in `browser`.
- Totals: **1189 unit / 66 e2e**, `tsc`/`eslint` clean.
