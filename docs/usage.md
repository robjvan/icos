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
