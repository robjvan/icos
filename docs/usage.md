# Usage

Operator notes for running ICOS. This is not a tutorial — it records the
behaviours that are deliberate and would otherwise look like bugs.

## Web client

The Angular client (`web-client/`, `:4200`) fronts the core REST API. Tabs are
honest about what exists: live tabs (Chat, Skills, Tools, Memory, MCP, Models,
Cron, Server, Identity) and placeholders for milestones that have not landed.

## Deleting a session

In the **Chat** tab, an open session has a **Delete** button beside **New**.
It asks for confirmation, then removes the session and its transcript.

Two things are deliberate:

- **You must open a session to delete it.** There is no hover-to-delete on the
  session list. That friction is intentional: deleting the session you are
  looking at is how you delete the one you mean, without inviting accidental
  deletions from the sidebar.
- **Memory survives.** Candidates, beliefs, promotions, and source evidence
  *derived* from a session are **not** deleted with it. Deleting a session
  clears the transcript, not what ICOS learned from it. This makes it harder to
  erase usage patterns or behaviour by wiping old sessions — and means clearing
  out old conversations will **not** remove facts you actually want gone.

To remove derived memory, do it explicitly under the **Memory** tab (review /
beliefs / ledger), where each item is deleted on its own terms.

## Tool discovery (M20.7)

ICOS keeps the full tool catalog in memory but does **not** send every schema
on every turn. Each turn injects a bounded, relevant set:

- a small **always-on core** (`TOOLS_ALWAYS_ON`, default
  `search_platform_tools,memory,todo`), plus
- tools **discovered** deterministically from your message, capped at
  `TOOLS_MAX_PER_TURN` (default 12; discovery limit `TOOLS_DISCOVERY_LIMIT`,
  default 8).

**Discoverability is not authorization.** Discovery only changes what the model
is *shown*. It can never surface a tool the operator disabled, never widen the
enabled set, and never bypass approvals — every call still runs through the
normal validation and approval path. A discovered tool is, by construction,
already enabled by your configuration (`TOOLS_ENABLED*` / `TOOLS_DISABLED*`).

### Pulling a tool on demand

If the model needs a tool that was not offered, it can call the always-on
`search_platform_tools` meta-tool; the matching schemas are injected on its next
step (bounded by `TOOLS_PULL_MAX_RESULTS` / `TOOLS_PULL_MAX_PER_TURN`). You can
do the same explicitly:

- `/tools pull <query>` — stage matching tools for the next turn;
- `/tools list` — every policy-enabled tool;
- `/tools status` — the discovery state and bounds;
- `/tools clear` — drop staged pulls for the session.

Pulls are **one-shot** for the next turn — ICOS does not accumulate discovered
schemas indefinitely.

### Turning it off

Set `TOOLS_DISCOVERY_ENABLED=false` to inject every policy-enabled tool on every
turn (the pre-M20.7 behaviour). The Tools tab shows the resolved discovery state
and bounds; `/tools status` reports the same.
