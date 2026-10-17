---
name: icos-channels
description: "The ICOS external channels (core/src/channels/): Discord and email as first-class surfaces — inbound turns, approval-gated outbound sends, and presence."
version: 1.0.0
author: ICOS
---

# ICOS Channels — Discord and Email

## Overview

Channels make ICOS reachable outside the web UI. Discord and email are
first-class: inbound messages become turns, outbound sends are approval-gated,
and Discord registers native slash commands.

## Status

**Implementation:** Active. M16.

**Maturity:** Prototype. **SMS is not built.**

**Last reviewed:** 2026-10-17.

## Location

**Source:** `core/src/channels/`. **Database:** `~/.icos/data/channels.db`.
**Route:** `/core/channels`.

## Key Files

- `channel-adapter.ts` / `channel.types.ts` — the adapter contract.
- `discord.adapter.ts` / `discord-ingress.service.ts` / `discord.stream.ts` —
  Discord inbound/outbound and native slash commands.
- `email.adapter.ts` — email.
- `channel-send.service.ts` / `channel-send.port.ts` /
  `channel-tool-sender.service.ts` — outbound delivery (the `channel.send` tool).
- `channel-delivery.service.ts` / `channel-presence.service.ts` — delivery and
  status/presence.
- `channel.repository.ts` / `sqlite-channel.repository.ts` — channel state.
- `channels.controller.ts` — the management API.

## Invariants

- Outbound sends are approval-gated, with their own allowlists.
- Inbound turns go through the normal loop; channels add no bypass.

## Do Not Assume

- Sending is free. It is gated.
- A channel is always connected. Presence is reported.
