# Expansion milestone (EXP) — tool surface, Discord commands, skills

> Status: **draft / not started**. Captured 2026-10-04 from operator notes.
> Sequencing: **M16 complete → EXP → M16.2d (attachment vision) → M17**.
> EXP-1 (tools) should land a `vision_analyze` tool, which M16.2d then consumes
> as the text-only fallback. Scope to be refined when the chunk is picked up.

## Why

M16 made ICOS a two-way Discord citizen and closed the external-comms
milestone. Before the next numbered milestone, three deliberately-thin areas
want building out: the **tool surface**, **Discord slash commands**, and the
**skill library**.

---

## EXP-1 — Build up the tool surface

The M8/M16 tool slice is intentionally minimal. Today the registry
(`core/src/tools/tool-registry.ts`) exposes three native tools —
`session.search`, `session.rename`, `channel.send` — plus foreign MCP tools.
The pattern to copy per tool is: descriptor + JSON schema + validator +
executor, optionally **approval-gated** (the `channel.send` parking path is
the reference for anything that has side effects).

**Candidates** (operator will bring `hermes` / other examples to speed this
up):

- `web_search` — needs a provider-agnostic backend and a network-egress story.
- `terminal` — high-risk; likely approval-gated and sandboxed.
- `vision_analyze` — describe an image for a text-only model. The local
  `gemma4:e4b` (native Ollama) now reports `vision` and accepts image input
  (verified live), so it can back this tool. **M16.2d (attachment vision)
  depends on this.**
- _TBD_: the full list is to be settled when the chunk starts.

**Questions to resolve**

- Which tools are read-only vs side-effecting (and therefore approval-gated)?
- Network egress: allow-list, timeout, and containment; never a raw shell
  without a policy.
- Per-tool credentials resolve through the existing **secret resolver** /
  vault (never hard-coded, never viewable).
- Every tool run should land in an observable ledger (mirror the
  `channel.send` outcome record).

---

## EXP-2 — Discord slash commands

**Current state.** ICOS already has a real internal command system:
`core/src/commands/` (`CommandDispatcher`, `CommandRegistry`,
`slash-command.parser.ts`) with `/status`, `/new`, `/export`, `/rename`,
`/undo`, `/fork`, `/health`, `/thinking`, `/timestamps`, `/restart`.
`ConversationService` dispatches a message that **starts with `/`**
(`conversation.service.ts`). What is missing is the **Discord native**
surface.

**Goals**

1. **Register ICOS's command set** as Discord *application commands*
   (`PUT /applications/{id}/commands`), derived from the internal registry so
   there is a single source of truth. This also **overwrites the stale set** —
   the "Hermes commands" currently visible are old application commands that
   persist on the same Discord app until replaced/cleared (dropping and
   re-adding the bot is one workaround; registering is the real fix).
2. **Handle `InteractionCreate` for `CHAT_INPUT`** and route it to
   `CommandDispatcher` (the adapter already handles button interactions for
   M16f approvals — extend, don't duplicate).
3. **Extend the command list** — operator wants opencode-style commands such as
   switching **provider/model**, viewing **session status**, etc. Settle the
   list when the chunk starts.

**Questions to resolve**

- Do text `/commands` already work in DMs (the ingress passes raw content to
  `converse`)? In channels a mention prefix would break `startsWith('/')`, so
  native commands are the channel path. Verify both.
- Guild-scoped vs global command registration; dev vs prod application ids.
- Clear the stale commands as an explicit one-off, or rely on overwrite.

---

## EXP-3 — Skills library

Author more `SKILL.md` files. The skill service loads from `~/.icos/skills/`
with frontmatter (note: one existing skill, `icos-legacy`, is currently skipped
as `bad-frontmatter` — worth cleaning up). The operator will draft a list of
skills; we build them together and validate.

**Questions to resolve**

- Frontmatter schema and validation rules (to avoid another `bad-frontmatter`).
- Catalog/context size limits (`skillsMaxCatalogItems`,
  `skillsMaxContextChars`, …) and how many can be active per turn.

---

## Suggested sequence

`M16.1 (email)` → pick an EXP order → `M17`. Each EXP item can likely become
its own short slice series once scoped.
