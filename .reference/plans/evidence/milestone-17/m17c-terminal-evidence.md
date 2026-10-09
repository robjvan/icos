# M17c.1 — Terminal tool + generic native approval: live evidence

> Status: **verified** (2026-10-07). Slice **M17c.1** (`terminal`). Per-slice
> evidence; M17c is in progress.

## What was built

- **Generic native approval path.** `claimApprovedNativeTool` in the ledger plus
  resume routing: any **native approval-required** tool (not just
  `channel.send`/`rename`) now mints an approval, parks at `awaiting_approval`,
  and executes through the native dispatcher once granted. This is the
  foundation `docker` will reuse.
- **`terminal` tool** (`toolset: 'terminal'`, `approval: 'required'`):
  - Runs `/bin/sh -c <command>`, **cwd jailed to the workspace root**
    (`cwd` confined; escape → `tool_failed`).
  - Default 30 s timeout (max 5 min), killing the **whole process group**
    (`detached` + `kill(-pid)`), so a shell's children die too.
  - 48 KiB stdout+stderr cap; `truncated` flag.
  - **Minimal env** (`PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `USER`,
    `SHELL`) — a command cannot read the core's secrets from the environment.
  - Returns `{command, cwd?, exitCode, timedOut, truncated, stdout, stderr}`.
- Registry: strict validator (`command` required, ≤4000 chars; `cwd` ≤500;
  `timeoutMs` 1s–5min).

### Approval policy

**Always approval-gated** (per the operator's choice). The approval description
shows the command. Scoped approvals ("approve once / for this session /
permanently") are a **future** feature, not built here.

## Unit

| Area | Spec |
| --- | --- |
| Validator (command/cwd/timeout bounds) | `tool-registry.spec.ts` |
| Execution: park → approve → run; cwd escape rejected | `tool-execution.service.spec.ts` |
| Offered-tool surface (17) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1148 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **17 tools**.

## Live

Container rebuilt, healthy. One turn:

```
user:  Use the terminal tool to run the command 'echo hello from the terminal'.

terminal {command: "echo hello from the terminal"} → approval_required (parked)
  approved 99b94555…: terminal {"command":"echo hello from the terminal"}
  resume → succeeded

reply: "Command: echo hello from the terminal
        Exit code: 0
        stdout: hello from the terminal
        stderr: (empty)"
```

The tool parked on approval, executed once granted, and the model relayed the
real stdout/exit code.

## Note

One tool call per step. The command ran inside the core container, jailed to
`TOOLS_WORKSPACE_ROOT`, with a scrubbed environment. `process_manage`
(background processes) is the next M17c slice.
