# M17b — Todo tool: live evidence

> Status: **verified** (2026-10-07). Slice **M17b.5** (`todo`). Per-slice
> evidence; M17 itself is still in progress.

## What was built

- `session_todos` table (sessions DB; cascades with the session) plus a
  `TodoRepository` / `SqliteTodoRepository`.
- `todo` tool: `list` / `add` / `complete` / `remove` / `clear`.
  `toolset: 'todo'`, `approval: 'none'`.

## Unit

| Area | Spec |
| --- | --- |
| Validators (per action, bounds) | `tool-registry.spec.ts` |
| Execution (list/add/complete) | `tool-execution.service.spec.ts` |
| Durable store (per-session, complete/remove/clear) | `sqlite-todo.repository.spec.ts` |

Totals at capture: **1120 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **12 tools**.

## Live

*"Call exactly one tool per step. Use the todo tool to add 'write the paper',
then add 'fix the skill files', then list all todos."*

```
reply: Todo list (2 items, both open):
       1. 0246e801 — write the paper
       2. 87069828 — fix the skill files

ledger: todo {action: add, text: "write the paper"}      → succeeded
        todo {action: add, text: "fix the skill files"}  → succeeded
        todo {action: list}                              → succeeded (2 todos)

session_todos:
  { id: 0246e801…, text: "write the paper",     status: "open" }
  { id: 87069828…, text: "fix the skill files", status: "open" }
```

The rows are durable in `~/.icos/data/sessions.db` (`session_todos`), scoped to
the session, and survive restart.

## Note

One tool call per step again: the turn chained `add` → `add` → `list` across
three steps (the loop permits one call per proposal). The model complied when
instructed.
