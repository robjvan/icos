# M17c.2 — Process tools (`process_start` / `process_manage`): live evidence

> Status: **verified** (2026-10-07). Slice **M17c.2**. Per-slice evidence; M17c
> is in progress.

## What was built

Background-process control, **split** so read-only actions stay approval-free:

- **`process_start`** (`approval: 'required'`) — starts a background
  `/bin/sh -c <command>` in the workspace jail (cwd confined). Returns
  `{id, pid, command, cwd, status, startedAt}`.
- **`process_manage`** (`approval: 'none'`) — `list` / `output` / `kill` over
  processes started via `process_start` **only**; it never touches arbitrary
  pids.
- **`ProcessRegistry`** — in-memory, per core process: buffers stdout/stderr
  (48 KiB cap, `truncated` flag), tracks `status`/`exitCode`, kills the whole
  process group, and caps concurrent processes at 8. A restart loses tracking
  (documented — this is working memory, not a durable job system).
- Shared **`terminalEnv()`** (minimal env; a process cannot read the core's
  secrets) moved to `process/terminal-env.ts`; approval action/description
  helpers generalized over native tools.

## Unit

| Area | Spec |
| --- | --- |
| Validators (process_start; process_manage actions) | `tool-registry.spec.ts` |
| Registry: output capture, exit, list, kill | `process/process-registry.service.spec.ts` |
| Execution: start (approval) → list → kill | `tool-execution.service.spec.ts` |
| Offered-tool surface (19) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1153 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **19 tools**.

## Live

Container rebuilt, healthy.

### Start + output + list

```
process_start {command: "for i in 1 2 3; do echo tick $i; sleep 1; done"}
  → approval_required (parked) → approved → succeeded
  → {id: c57000bb…, pid: 57, status: running}

process_manage {action: output, id: c57000bb…} → tick 1 / tick 2 / tick 3
process_manage {action: list} → the process, status exited, exitCode 0
```

### Start + kill

```
process_start {command: "sleep 300"} → approved → running (id e3b51dfe…)
process_manage {action: list}  → found the running sleep 300
process_manage {action: kill, id: e3b51dfe…} → {killed: true}
```

The model correctly found the running process via `list` and killed it; a
prior `sleep 300` from an earlier attempt showed as `exited` (its `kill` had
executed before that turn's final LLM call 502'd).

## Note

- **In-memory registry.** A core restart orphans running children and loses the
  registry — acceptable for now; a durable job system is future work.
- **`repeated_call` guard.** The model hit `repeated_call` when it polled the
  same `process_manage output` twice in one turn (M9j repetition guard blocks an
  identical repeat). It worked around it via `list`. This is the same known
  follow-up already recorded in the M17 plan.
