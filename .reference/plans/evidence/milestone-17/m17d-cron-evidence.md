# M17d.1 — Cron (`cronjob_manage`): live evidence

> Status: **verified** (2026-10-09). Slice **M17d.1**. Per-slice evidence; M17d
> is in progress.

## What was built

An approval-free `cronjob_manage` tool (`toolset: 'cron'`) over a durable
in-process scheduler:

- **`cron_jobs` table** + `CronJobRepository` / `SqliteCronJobRepository`
  (name, schedule, prompt, session, optional delivery, enabled, last/next run).
- **Minimal 5-field cron parser** (`cron-expression.ts`): star, exact values,
  ranges, lists, and steps; `nextCronRun` at minute resolution.
- **`CronScheduler`**: an in-process 30 s tick runs every due, enabled job —
  the job's prompt is run as a turn (in the job's session), and the reply is
  delivered through the channel-send port when the job configured a target.
  Errors are logged and never crash the tick. The conversation service is
  resolved **lazily** (`ModuleRef`) to avoid a construction cycle
  (tools → cron → scheduler → conversation → tools).
- **Tool actions**: `list`, `create`, `pause`, `resume`, `remove`, `run`.
  Creating a job in a session defaults its `sessionId` to that session.

### Notes

- A run whose turn **parks** (an approval-gated tool) leaves the approval
  pending for the operator — the scheduler does not resume it, so unattended
  jobs are effectively limited to approval-free tools.
- Delivery is optional; without it the reply stays in the job's session.

## Unit

| Area | Spec |
| --- | --- |
| Cron parse + next-run | `cron/cron-expression.spec.ts` |
| Durable store (CRUD, due, record run) | `cron/sqlite-cron-job.repository.spec.ts` |
| Validator (create/management shapes) | `tool-registry.spec.ts` |
| Execution (list/create/remove) | `tool-execution.service.spec.ts` |
| Offered-tool surface (23) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1171 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **23 tools**.

## Live

Container rebuilt, healthy.

```
cronjob_manage {action: create, name: "test-job", schedule: "0 3 * * *",
                prompt: "Say hello in one short sentence."}
  → created; next run 2026-10-10T03:00:00Z

cronjob_manage {action: list}  → the job, enabled, next run 2026-10-10T03:00:00Z

cronjob_manage {action: run, id: 22e657c1…}
  → ran the prompt as a turn → reply "Hello — good to see you." (delivered: false)

cronjob_manage {action: remove, id: 22e657c1…} → {removed: true}
```

Create/list/run/remove all returned the real durable state; `run` actually
executed the prompt as a turn and returned the model's reply.

## Note

One tool call per step. Remaining M17d: `execute_code` (worker + tool-RPC) and
`browser` (Playwright); `computer_use` deferred.
