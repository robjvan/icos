# M17d.2 — Execute code + tool-RPC bridge: live evidence

> Status: **verified** (2026-10-09). Slice **M17d.2**. Per-slice evidence; M17d
> is in progress.

## What was built

An approval-gated `execute_code` tool (`toolset: 'code'`) and the tool-RPC
bridge that lets a script call ICOS tools:

- **`execute_code`**: runs a Python or JavaScript script in the workspace. It
  shares the `terminal` spawn helper (`spawnCaptured`): cwd jailed to the
  workspace, a scrubbed env, a 30 s timeout killing the process group, and a
  48 KiB output cap. The temp script file is removed after the run.
- **Tool-RPC bridge**: the script is handed `ICOS_RPC_URL` and a short-lived
  `ICOS_RPC_TOKEN`. `POST /core/tools/rpc` (public at the auth-guard level,
  gated by the token) executes **only approval-free tools in the token's
  session** — the session comes from the token, never the request, and an
  approval-gated tool is rejected (`requires_approval`): a script cannot approve
  on the operator's behalf.
- **`ToolRpcTokens`**: in-memory, per-run, 10-minute TTL; revoked when the run
  ends.

### Notes

- The script runs **inside the core container** (same risk profile as
  `terminal`: it can read the workspace and, being unjailed at the filesystem
  level, the data dir — mitigated by approval-gating). A filesystem sandbox is
  future work.
- The RPC call routes through the ledger like any tool call (audited).

## Unit

| Area | Spec |
| --- | --- |
| Token issue/verify/revoke | `tools/tool-rpc.tokens.spec.ts` |
| Validator (code + language) | `tool-registry.spec.ts` |
| Execution: approval → run (real `node`) | `tool-execution.service.spec.ts` |
| Offered-tool surface (24) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1175 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **24 tools**.

## Live

Container rebuilt, healthy.

### Plain script

```
execute_code {language: "python", code: "print(\"hello from python\")"}
  → approval_required → approved → exit 0
  → stdout "hello from python"
```

### RPC bridge (a script calling an ICOS tool)

```
execute_code {language: "python", code: "<urllib POST to ICOS_RPC_URL with the
              ICOS_RPC_TOKEN, calling memory {layer: beliefs, query: obsidian}>"}
  → approval_required → approved → exit 0

returned the memory tool's result:
  f0275aac… preference:Isabel_uses requires_source_to_verify strong_preference_to_use_obsidian_vaults (active, agent)
  f5fccf46… person:Isabel        strongly_prefers          obsidian_vaults_for_notes                (active, user)
```

The script successfully invoked the `memory` tool through the RPC bridge and
received its structured result — the full execute_code + tool-RPC capability.

## Note

One tool call per step. Remaining M17d: `browser` (Playwright); `computer_use`
deferred.
