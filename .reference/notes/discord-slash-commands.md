# Discord slash commands (M20 slice)

> Moved here when the EXP plan was retired (2026-10-06). This is the **EXP-2**
> content; it lands under **M20 (Web Client UI Catch-up)** as the Discord
> native-command slice. Not started.

## Current state

ICOS already has a real internal command system: `core/src/commands/`
(`CommandDispatcher`, `CommandRegistry`, `slash-command.parser.ts`) with
`/status`, `/new`, `/export`, `/rename`, `/undo`, `/fork`, `/health`,
`/thinking`, `/timestamps`, `/restart`. `ConversationService` dispatches a
message that **starts with `/`** (`conversation.service.ts`). What is missing
is the **Discord native** surface.

## Goals

1. **Register ICOS's command set** as Discord *application commands*
   (`PUT /applications/{id}/commands`), derived from the internal registry so
   there is a single source of truth. This also **overwrites the stale set** —
   the "Hermes commands" currently visible are old application commands that
   persist on the same Discord app until replaced/cleared (dropping and
   re-adding the bot is one workaround; registering is the real fix).
2. **Handle `InteractionCreate` for `CHAT_INPUT`** and route it to
   `CommandDispatcher` (the adapter already handles button interactions for
   M16f approvals — extend, don't duplicate).
3. **Extend the command list** — opencode-style commands such as switching
   **provider/model**, viewing **session status**, etc. Settle the list when the
   slice starts.

## Questions to resolve

- Do text `/commands` already work in DMs (the ingress passes raw content to
  `converse`)? In channels a mention prefix breaks `startsWith('/')`, so native
  commands are the channel path. Verify both.
- Guild-scoped vs global command registration; dev vs prod application ids.
- Clear the stale commands as an explicit one-off, or rely on overwrite.
