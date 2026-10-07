# M17b — File tools: live evidence

> Status: **verified** (2026-10-07). Slices **M17b.1** (generic native path +
> `read_file`/`search_files`) and **M17b.2** (`write_file`/`patch`).
> Per-slice evidence; M17 itself is still in progress.

## What was built

- A **generic native-tool execution path**: `NativeToolOutcome` +
  `claimNativeTool` + widened `finishTool`, so approval-free native tools flow
  through one path (claim → dispatch → finish → shared final response).
- `read_file`, `search_files`, `write_file`, `patch` — `toolset: 'files'`,
  `approval: 'none'`.
- Confinement to `TOOLS_WORKSPACE_ROOT` (default `~/.icos/workspace`); a path
  resolving outside is refused. Write targets resolve the deepest existing
  ancestor, so a symlinked parent cannot escape.

## Unit

| Area | Spec |
| --- | --- |
| Schemas + validators (accept/reject, bounds) | `tool-registry.spec.ts` |
| Execution, confinement (escape refused) | `tool-execution.service.spec.ts` |

Totals at capture: **1115 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **9 tools** (session.search,
session.rename, channel.send, read_file, search_files, write_file, patch,
web_search, web_extract).

## Live

Workspace root `TOOLS_WORKSPACE_ROOT=/Users/rob/.icos/workspace` (host-absolute,
so it survives rebuilds). Seeded `notes/welcome.md` containing
`secret-code: ORCHID-42`.

**Read** — a real turn: *"Use the read_file tool to read 'notes/welcome.md' …"*

```
reply: read_file returned the contents of `notes/welcome.md`: … secret-code: ORCHID-42
ledger: read_file { path: notes/welcome.md } → succeeded
        result { path, bytes: 103, truncated: false, content: "…ORCHID-42\n" }
```

**Write + patch (multi-step)** — *"…write_file 'notes/from-agent.md' = 'written
by ICOS', then patch to 'patched by ICOS', then read it back"*:

```
ledger: write_file { path: notes/from-agent.md, content: "written by ICOS" } → succeeded
        patch      { oldString: "written by ICOS", newString: "patched by ICOS" } → succeeded
        read_file  { path: notes/from-agent.md } → succeeded
host:   ~/.icos/workspace/notes/from-agent.md == "patched by ICOS"
reply:  "Done. Final content of `notes/from-agent.md`: patched by ICOS"
```

## Defect found and fixed during this run

The multi-step write/patch turn first failed with a **502**:
`[opencode] LLM endpoint returned HTTP 400: The reasoning_content in the
thinking mode must be passed back to the API`. The thinking model requires the
`reasoning_content` that accompanied an assistant tool-call message to be
echoed back on the next request; ICOS never captured it. Fixed in `3ffc7b3`
(capture in `CompletionParser`, carry on `LlmMessage`/`LlmResult`, emit via
`ToolOffer`, thread through the executor + conversation pair sites). After the
fix the multi-step turn succeeds (above).

## Notes / boundaries

- Writes are **approval-free inside the workspace** (the workspace is the
  agent's sandbox). A `kb/` child of the workspace is therefore read+write
  reachable — intended for M23 stewardship.
- Reads and search are bounded (256 KB read, bounded result set); `search_files`
  skips `node_modules`/`.git`.
