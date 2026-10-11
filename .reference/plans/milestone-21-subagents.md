# M21 — Subagent Support

> Status: **planned** (2026-10-11). Source: roadmap M21 checklist
> (`.reference/plans/full-roadmap-extended.md`), Hermes Agent's delegation
> model as a reference point, and operator decisions below. No code yet —
> this document is the implementation plan.

## Objective

Let the agent peel work off into **isolated child sessions that run detached
from the parent turn**: each child gets a fresh transcript, its own iteration
budget, and a narrowed toolset; it returns only a bounded summary. The parent
turn never blocks — it gets a `task_id` back immediately and polls for
results. Context isolation is the point: parallel workstreams (research vs.
implementation, independent subtasks) must not leak into each other or bloat
the parent's context.

## Where Hermes parity holds, and where ICOS diverges

Hermes reference (operator-supplied summary): isolated children via
`delegate_task`, flat hierarchy (depth 1 default), async with `task_id`,
`/agents` overlay with steering/cancel, cheaper-model routing, ephemeral
children.

Kept: isolation, async `task_id`, flat-only, status/cancel, bounded
summaries, ephemeral-by-default children.

Diverged (ICOS constraints win):

- **Approvals are never bypassed.** Hermes inherits the parent's toolset
  *and credentials*; ICOS routes every approval-gated call (terminal,
  channel.send, discord_admin, execute_code, process_start) through the
  normal operator approval path, tagged with the parent goal. A child is
  *less* privileged in practice, never more.
- **Memory is shared with provenance, not discarded.** ICOS's ledger is the
  system of record; child transcripts extract into it stamped with the child
  session id, and the delegation record links child → parent. Hermes's
  "work is ephemeral" becomes "work is traceable."
- **No separate model routing in M21.** ICOS has one conversation role;
  cheaper-model delegation waits on the provider/role work, not this
  milestone.
- **No mid-flight steering in M21** (Hermes "Pantheon" feature). Status +
  cancel now; steering is a stated future.

## Design

### 1. Lifecycle and records

New durable `delegations` table (sessions DB): `id` (task_id), `parent_session_id`,
`child_session_id`, `parent_run_id`, `goal`, `state`
(`running | awaiting_approval | completed | failed | cancelled |
budget_exhausted`), `result_summary`, `error`, `budgets_json`,
`created_at`, `updated_at`. Child turns write normal `agent_runs` rows under
the **child** session id — no ledger changes needed.

Restart semantics (honest, matches the process-registry precedent): on boot,
any delegation still `running`/`awaiting_approval` is marked `failed` with
reason `restart`. No resurrection, no silent loss — the record says what
happened.

### 2. Tools (all approval:`none`, like `cronjob_manage`)

- `delegate_task { goal*, context?, toolsets?, tools? }` → `{ task_id }`.
  Creates the child session (fresh, never a fork — isolation is the point),
  writes the delegation record, and launches the child detached. Refuses when:
  delegation is disabled, the concurrency cap is hit, or the **caller session
  is itself a child** (flat-only enforcement, no policy change needed).
- `delegate_status { task_id }` → state, progress counters, and (when
  terminal) the bounded summary. The parent's polling path.
- `delegate_cancel { task_id }` → marks cancelled; the child loop checks the
  flag each iteration and terminates truthfully (`cancelled`, partial work
  kept in the child transcript).

### 3. Detached runner

The child runs the **same turn loop** (`converse`-equivalent scoped to the
child session) as a background promise — never awaited by the parent. Per-child
budgets, all configurable, all conservative:

- `SUBAGENT_MAX_CONCURRENT` (default 4) — spawn refuses past the cap.
- `SUBAGENT_MAX_ITERATIONS` / `SUBAGENT_MAX_TOOL_STEPS` — child loop caps
  (defaults mirror the parent loop: 5/5).
- `SUBAGENT_MAX_TURN_DURATION_MS` (default 300000) — shorter than a parent
  turn; expiry terminates `budget_exhausted` with a forced text answer
  (existing `terminalRun` semantics), and the partial summary is still
  returned.
- `SUBAGENT_RESULT_MAX_CHARS` (default 4000) — summaries truncate with an
  explicit marker, so a verbose child cannot flood the parent.

Background-promise discipline: a child rejection must **never** throw into the
parent or crash the process — every exit path (completed/failed/cancelled/
budget_exhausted/restart) lands in the delegation record.

### 4. Parent ↔ child transfer

- **Down (parent → child):** the `goal` plus an explicit `context` string.
  The parent transcript is *not* copied. If the model wants the child to see
  something, it says so in `context` — explicit transfer, no leakage.
- **Up (child → parent):** the bounded summary, available via
  `delegate_status` and pushed as a realtime `session.updated`-family event
  for the client. (A next-turn completion band in the parent's context is
  M21.2.)

### 5. Approvals (routed, tagged)

A child's approval-gated call parks the child run through the existing
`parkRun` path and surfaces through the existing approval cards/queue, with
the delegation id + parent goal attached so the operator sees *why* this
approval exists. Approve/deny then resumes or fails the child normally; the
parent observes via `delegate_status`. No new approval machinery, no bypass,
no auto-approve inheritance.

### 6. Capability boundaries

M21.1: the child toolset is the parent's policy universe **minus
`delegate_task`** (flat-only), with the `tools`/`toolsets` args reserved in
the schema. M21.2: honor those args via a per-session policy overlay in
`ToolSurfaceService` (general narrowing — `injected ⊆ universe` invariant
from M20.7 holds for children too). A staged/pulled tool the child may see
still validates + approves normally.

### 7. Memory (shared with provenance)

No extraction changes: child turns call the same `extractTurn` path, so
candidates land in the shared ledger stamped with the child session id, and
the delegation record makes child → parent walkable. The returned summary
lives in the parent transcript and is extractable from there like any other
turn content.

### 8. Config

- `SUBAGENTS_ENABLED` (default **true** — per the M20.7 philosophy, tested
  behavior ships on with a conservative budget; operator override disables).
- The five budgets above.
- Kill behavior stays simple: `delegate_cancel` per task; no global kill-switch
  beyond disabling future spawns (a delegated turn already running finishes
  under its own budget).

## Slices

- **M21.1 — Async delegation core.** Delegations table + store; the three
  tools; detached runner with budgets and background-promise discipline;
  flat-only refusal; failure/timeout/cancel semantics; result truncation;
  restart-marking. No approval tagging, no overlay, no surface yet (child
  approvals work through the untagged path).
- **M21.2 — Integration.** Approval tagging (delegation id + parent goal on
  cards/queue); per-session policy overlay honoring `tools`/`toolsets`;
  next-turn completion band in the parent context; `/agents` command (list /
  status / cancel); Agents tab replaces the placeholder; Discord visibility
  for delegations.
- **M21.3 — Hardening + evidence.** Parallel fan-out limits under test,
  approval-deadlock walkthrough (child parked while parent polls — document
  the latency honestly), docs (`usage.md` + model-lineups note), and
  committed evidence: a live multi-child parallel run with a real model.

## Verification plan

- **Unit:** spawn refusal paths (disabled / cap / child-calls-delegate);
  state machine transitions incl. cancel-mid-run and restart-marking;
  budget enforcement (iterations, steps, duration, result truncation);
  result never throws into the parent; flat-only (no `delegate_task` in
  child universe); `SUBAGENTS_ENABLED=false` restores exact pre-M21 behavior.
- **e2e:** full async round-trip with stubbed LLM — spawn → poll running →
  child completes → summary retrievable; child approval parks and resumes via
  the normal path; cancel terminates truthfully.
- **Live:** a real multi-child parallel run; `/agents` shows them; a child
  approval surfaces tagged and resolves; transcripts + ledger show the
  provenance chain.

## Risks

- **Background execution inside a request-scoped server.** The detached runner
  must not leak request contexts, must survive nothing (restart = honest
  failure), and must bound concurrency. This is the highest-risk piece —
  hence async mechanics all land in M21.1 with the strictest tests.
- **Approval latency, not deadlock.** A child parked on approval while the
  parent polls is *correct* but slow; the plan documents it rather than
  engineering around it in M21.
- **Fan-out cost.** Each child is a full loop with LLM calls; the concurrency
  cap + per-child budgets + result truncation bound it. Cheaper-model routing
  is the future lever, explicitly out of scope.
- **Scope discipline.** Steering, nested delegation, and model routing are
  named futures, not stretch goals — they do not creep into acceptance.

## Decisions (confirmed 2026-10-11)

1. **Execution:** **async-first** (task_id + poll), Hermes-style.
2. **Child approvals:** **routed through the normal path, tagged** with
   delegation id + parent goal. No bypass, no auto-deny.
3. **Child memory:** **shared ledger with provenance** (child session id
   stamp + delegation link), not isolated/discarded.
4. **Nesting:** **flat only** — a child session calling `delegate_task` is
   refused; depth counter reserved for later.
5. **Surface:** `/agents` command + real Agents tab land in M21.2, not M21.1.
