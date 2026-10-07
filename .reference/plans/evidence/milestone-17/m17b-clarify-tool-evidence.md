# M17b — Clarify tool: live evidence

> Status: **verified** (2026-10-07). Slice **M17b.7** (`clarify`). Per-slice
> evidence; M17 itself is still in progress.

## What was built

A native, approval-free `clarify` tool (`toolset: 'agent'`) that asks the user a
question and **parks the turn** until it is answered. Full park/resume, riding the
existing M6 clarification flow.

- **Registry**: `clarify` descriptor + strict validator — `question` required;
  `options` 2–4 non-empty strings; `ttlMs` 1s–24h.
- **Ledger**: new `awaiting_clarification` park state and a `clarification_id`
  binding column (FK to `clarifications(id)`), bound at INSERT exactly like
  `approval_id` (the immutability trigger forbids binding afterwards). A table
  rebuild migration adds both, preserving every row and converging the trigger.
- **Executor**: `consume` mints the clarification *before* registering, so the FK
  binding rides the INSERT; `resume` claims the parked call once answered and
  finishes with `{question, answer, options}`, or mirrors `cancelled`/`expired`.
  A poll before an answer leaves the row parked.
- **Conversation**: new `clarification_required` turn status (outcome + stream
  event + response DTO). The run parks via `markParkedForInteraction`; the answer
  re-enters bounded planning with the answer as the tool result.
- **agent_runs**: records the `clarification_id` (reuses the shared parked
  lifecycle value; the run is blocked on a person, not the model).

### Design notes

- **Park/resume, not a thin wrapper.** The tool blocks and the answer comes back
  as the tool result, so the model can continue its task with it — the same shape
  as approvals, with a free-form/choice answer instead of approve/reject.
- **Answers never leak into the transcript as user turns.** They arrive through
  the explicit clarifications API, bind to the request id + owning session, and
  reach the model only as the tool observation.
- **Run state reuse.** `agent_runs.state` stays `awaiting_approval` (a generic
  "parked awaiting a human interaction"); the clarification id is stored in a new
  additive column. No `agent_runs` CHECK rebuild was needed.

## Unit

| Area | Spec |
| --- | --- |
| Validator (question/options/ttlMs bounds) | `tool-registry.spec.ts` |
| Park → answer → resume; pending poll stays parked | `tool-execution.service.spec.ts` |
| Turn parks as `clarification_required`; resume continues planning | `conversation.service.spec.ts` |
| Pre-M17b table rebuild (state + column + trigger) | `session/database.spec.ts` |
| Offered-tool surface (14) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1127 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **14 tools**.

## Live

Container rebuilt (`docker compose build core && up -d core`), healthy. One turn:

```
user:  Use the clarify tool to ask me which color I prefer. Offer exactly
       these two options: 'teal' and 'red'.

clarify 046dd14c…: "Which color do you prefer?" options=["teal","red"]
                   -> answered "teal"          (POST /core/clarifications/:id/answer)

turn trace: ["clarification_required"]         (parked)
final:      status ok, tool {name: "clarify"}
reply:      "You picked **teal**."
```

Durable state after the turn:

```
tool_requests: state=succeeded  clarification_id=046dd14c…  approval_id=null  invocation_id=c3f4f58e…
agent_runs:    state=completed  clarification_id=046dd14c…  termination={"reason":"final_answer","toolSteps":1}
clarifications: status=answered  answer="teal"
```

The answer flowed back as the clarify tool result and the model continued from
it — the intended full park/resume.

## Note

One tool call per step again. The frontend/answer UI is M20; the flow is fully
exercisable over the API today (create → answer → resume), which is how this
evidence was captured. A pending poll keeps the run parked rather than
completing it, so an answer arriving later still resumes planning.
