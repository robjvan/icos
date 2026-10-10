# M20 — Web/Client Surface Catch-Up

> Status: **planned** (2026-10-09). Source: `.reference/notes/m20-web-client-rollup.md`
> (M20a–M20o). Carved into sub-milestones **M20.1–M20.7**; one item deferred.
> Related: **M17a** (tool policy — the auto-approve foundation), **M18** (skills
> discovery — the model for "tools out of context"), **M19** (MCP toolsets),
> **M21** (subagents — the Agents tab).

## Objective

Close the gap between the Angular client and the backend it fronts: fix the
frontend correctness leaks, wire the read-only surfaces to real endpoints, add
the deliberate destructive/bulk actions, finish the Discord native-command
integration, and land two larger context features. Keep the client honest — no
control should promise functionality the server does not provide.

## Cross-cutting findings (from the recon)

- **Client:** Angular 21, standalone components, signals, **Tailwind v4** with
  CSS-variable theme tokens (`web-client/src/styles.css`). No Angular Material.
- **Styling bug class:** each tab defines its own `.tab-pane` / `.badge` /
  `.grow` classes under emulated encapsulation; MCP/Models/Server omit them, and
  there is no global definition — hence the unstyled tabs. Fix = promote the
  shared tab classes to global `styles.css` (or a shared stylesheet).
- **Missing backend endpoints** the UI needs: **tools inventory**, **cron
  management**, **session delete**, **ledger ranking**, **per-tool auto-approve**.
  Several items are therefore backend + frontend, not pure UI.
- **Extra styling defects found:** `identity-tab.css` references undefined tokens
  (`--surface-2`, `--border-color`, `--danger`, `--warning`, `--font-mono`);
  `login-page.html` uses undefined `--accent-blue`; `footer-component.css` has a
  stray global `hr` rule.

## Sub-milestones

| # | Name | Rollup items | Surface |
| --- | --- | --- | --- |
| M20.1 | Frontend correctness & polish | a, b, c, d, n | frontend |
| M20.2 | Skills & Tools surfaces | e, f | frontend + backend |
| M20.3 | Memory ledger & Cron surfaces | g, h | frontend + backend |
| M20.4 | Destructive & bulk actions | i, j | frontend + backend |
| M20.5 | Discord native commands (EXP-2) | k | backend |
| M20.6 | Context budget & compaction | l | backend + frontend |
| M20.7 | Tools out of context | m | backend + frontend |
| — | Scratchpad | o | **deferred → M29** (per `memory-layers-seed.md`) |

Ordering: **M20.1 first** (the leaks the operator wants plugged), then the
surface wiring (M20.2–M20.3), then actions (M20.4), then the independent backend
slice (M20.5), then the two larger features (M20.6–M20.7).

---

## M20.1 — Frontend correctness & polish

> **Done** (2026-10-09) — operator-tested. Commits: `5207d2b` (initial) +
> `2b9937f` (inline-code `/g`, pipe tables, chat-overflow fixes).

**Covers:** M20a (markdown), M20b (tab styling), M20c (duplicate controls),
M20d (viewport overflow), M20n (credit). Plus the extra styling defects above.

- **Markdown (a):** the chat renders `{{ message.content }}` as pre-wrapped
  text (`message-list.html:4`). Add a sanitized markdown renderer (bold, code,
  lists, links) for assistant/user content. Must go through Angular's
  `DomSanitizer` (or a safe renderer) — never `innerHTML` of raw model output.
- **Tab styling (b):** promote `.tab-pane` / `.tab-pane-header` / `.badge` /
  `.grow` / `.notice` to global styles; MCP/Models/Server then inherit them.
  Fix the undefined CSS tokens (`identity-tab`, `login-page`, footer `hr`).
- **Duplicate controls (c):** remove the topbar theme text button (keep the
  footer icon) and the topbar cog (keep the Client tab).
- **Overflow (d):** fix the height chain — `app-root` has no height, so
  `height:100%` panes can't clip to the view. Constrain the shell so Chat's
  sidebar and Identity scroll within the viewport, not past the footer.
- **Credit (n):** a shoutout to Hermes Agent (About modal + README) as the
  source of the adapted `skill` files and the inspiration for the `tool` files.

**Tests:** Angular unit tests for the markdown renderer (XSS cases) and any
logic touched; manual/live check that the three tabs render styled and the two
overflow pages scroll.

**Risk:** low. Pure frontend.

---

## M20.2 — Skills & Tools surfaces

> **Done** (2026-10-09). Commits: `96cc548` (M20e) + `3ee72a7` (M20f). See
> `evidence/milestone-20/m20.2-skills-tools-evidence.md`.

**Covers:** M20e (skills modal + discover), M20f (tools inventory +
auto-approve).

- **Skills (e):** clicking a skill opens a **modal** (currently an inline
  article); the Discover bar should show **only** matches when non-empty, and
  the full catalog only when the query is empty. The stray number is
  `match.score` — label it or drop it.
- **Tools (f):** replace the static 2-entry registry with the **real tool
  inventory** from the backend, and make the auto-approve checkbox work.
  - **Backend:** a read-only tools inventory endpoint (the existing
    `@Controller('core/tools')` is the execute-code RPC bridge — add a distinct
    route, e.g. `GET /core/tools/inventory`, returning name/toolset/approval/
    description). Auto-approve = a **per-tool approval override** in the M17a
    policy layer (server-persisted), honored by tool execution.
  - **Frontend:** render the inventory; wire the checkbox to the override.
- **Agents (f):** leave as a placeholder explicitly marked "needs M21
  (subagents)"; do not fake it.

**Tests:** inventory endpoint + approval-override unit tests; execution honors
the override; UI wiring.

**Risk:** medium (the auto-approve override is a real policy feature — scope it
to per-tool, global, persisted).

---

## M20.3 — Memory ledger & Cron surfaces

> **Done** (2026-10-10). Commit `7cec6c8`. See
> `evidence/milestone-20/m20.3-memory-cron-evidence.md`.

**Covers:** M20g (ledger ranking), M20h (cron tab).

- **Ledger ranking (g):** the "ranking unimplemented (M10–M12)" badge is stale —
  ranking exists server-side (`memory/rank.service.ts`) but the ledger endpoint
  doesn't expose it. Add sort/rank parameters to the candidates/ledger endpoint
  and drop the badge.
- **Cron (h):** server-side cron is implemented (`cron.service.ts`,
  `cron-scheduler.service.ts`) but has **no HTTP controller** — it's only
  reachable via the `cronjob_manage` tool. Add a cron controller
  (list/create/delete/pause?) mirroring the tool's capability, and build the
  Cron tab against it.

**Tests:** endpoint tests (list/create/delete, ownership/validation); UI.

**Risk:** medium (cron controller must mirror the tool's safety — bounded
schedules, no secret leakage in prompts).

---

## M20.4 — Destructive & bulk actions

> **Done** (2026-10-10). Commit `c0f049f`. See
> `evidence/milestone-20/m20.4-destructive-bulk-evidence.md`.

**Covers:** M20i (session delete), M20j (bulk approve/reject).

- **Session delete (i):** add `DELETE /core/sessions/:id` (backend; cascade the
  session's messages/ledger rows), a delete button in the chat header next to
  "+ New", and a usage-doc note explaining the deliberate friction (you must
  open a session to delete it — no hover-to-delete).
- **Bulk approve/reject (j):** add bulk approve/reject for memory candidates
  (backend batch endpoint + a confirm dialog stating exactly what will change)
  in the Memory/Review tab.

**Tests:** delete cascade + auth; bulk endpoint bounds (cap batch size,
idempotent); confirm-dialog copy.

**Risk:** medium (destructive; both need explicit confirmation and a clear
review boundary).

---

## M20.5 — Discord native commands (EXP-2)

> **Done** (2026-10-10). Commits `6ff5c53` + `b93a858`. See
> `evidence/milestone-20/m20.5-discord-commands-evidence.md`.

**Covers:** M20k. Source: `.reference/notes/discord-slash-commands.md`.

Register ICOS's internal command registry as Discord **application commands**
(single source of truth), handle `InteractionCreate` for `CHAT_INPUT` and route
to `CommandDispatcher` (extend the existing button-interaction adapter), and
settle the command list (provider/model switching, session status, …).
Independent of the web client.

**Tests:** command registration mapping; interaction routing; stale-command
overwrite. Live: register against the dev app and verify a native command runs.

**Risk:** medium (external Discord API; dev vs prod application ids).

---

## M20.6 — Context budget & compaction

**Covers:** M20l. Source: the ChatGPT notes in the rollup.

Implement compaction as a **context-budget policy**, not a character threshold:
estimate context against the model's usable budget (after reserving system
prompt + tools + expected output), let the user set a target (e.g. 80%),
summarize older turns while preserving recent turns and required structured
sequences, keep the result inspectable, and avoid re-triggering on the same
oversized conversation. Settings UI for the target.

**Tests:** budget estimation; trigger/re-trigger guards; tool-call/result
sequence integrity; summarization boundary.

**Risk:** medium-high (touches the turn loop; must never corrupt structured
tool message sequences). May be sliced further when planned.

---

## M20.7 — Tools out of context

**Covers:** M20m. Source: `.reference/notes/tools-out-of-context.md`.

Stop injecting every tool schema every turn. Two candidate patterns:
1. **Intent-classifier gateway** — a fast model (or semantic search) selects
   2-3 relevant tool schemas before the main LLM sees the message.
2. **Router meta-tool** (`search_platform_tools`) — one permanent tool schema;
   the harness resolves the query to schemas and injects them next turn.

**Key insight:** ICOS already has the pattern for skills — deterministic
`skill-discovery.ts` + a budgeted `skill-selector.ts` + explicit
`/skills pull`. The cleanest path is to **generalize that to tools** (a tool
discovery/selector over the registry, with an explicit pull path) rather than
introducing a second mechanism, and to keep MCP toolsets (M19) as the discovery
domain.

**Tests:** selection quality/recall, budget bounds, no schema leakage across
turns, explicit-pull path.

**Risk:** high — the largest item; it changes the tool-offer pipeline. Consider
splitting into its own milestone (M20.7 → a standalone M) if it grows.

---

## Deferred

- **M20o — temporary scratchpad:** per `.reference/notes/memory-layers-seed.md`
  this is a memory-layer patch that pairs with **M29** (long-horizon agency) and
  **M34** (continuity). Deferred to the memory/agency band, not M20.

## Decisions (confirmed 2026-10-09)

1. **Scope:** work the whole plan, **one sub-milestone at a time**, starting
   with M20.1. No committed evidence for M20.1 — the operator tests it manually.
2. **Auto-approve (M20f):** a **global per-tool** override (persisted
   server-side).
3. **Tools out of context (M20.7):** **generalize the existing skills-discovery
   + selector** to the tool registry, with an explicit pull path.
