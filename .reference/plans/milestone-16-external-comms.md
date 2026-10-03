# ICOS v3 — Milestone 16: External Communication Integrations

> **Scope:** Discord (bidirectional) first; Email via Brevo as **M16.1**.
> SMS dropped (no viable free tier; not worth it). Grounded in the v2
> discord-bot under `.reference/legacy/discord-bot/`, adapted to the v3
> single-process core.

## Objective

Make ICOS reachable through an external channel and able to reply there:
an operator can talk to the agent from Discord, and the agent (or a human via
API) can send messages out — with the same durable, provenance-traced,
approval-gated discipline as everything else. The agent's replies carry the
same memory and identity, whatever channel they arrive on.

### Research question

> Can the runtime hold a real conversation through an external transport —
> receiving, mapping to durable sessions, replying, and surfacing approvals —
> without a second service, a message broker, or a second source of truth?

## Architectural boundary (v2 → v3)

v2 split this across `discord-bot`, `event-gateway`, `nexus-engine`, and
`chat-service`, wired by RabbitMQ. **v3 keeps it in one process.**

| Concern | v2 | v3 (this milestone) |
| --- | --- | --- |
| Process | separate `discord-bot` service | a **channels module inside `core`** |
| Transport of events | RabbitMQ (`isabel.events`) | in-process; persisted delivery records |
| Inbound normalization | Nexus `/ingress` chokepoint | `ChannelAdapter` boundary → `ConversationService` |
| Outbound delivery | AMQP `gateway.session.delivery.requested` | `ChannelDeliveryService` reading a durable queue |
| Identity | JSON identity map | config allowlist + mapping to the single-user seam |
| Channel routing | channel *topic* marker `[isabel-stream: X]` | same idea, re-marked `[icos-stream: X]`, plus config fallback |

**What we keep from v2:** discord.js; self-designating channels; thread-aware
session/conversation ids; per-stream rendering; interactive approval buttons;
transport-grade provenance; degraded mode when Discord is unreachable.
**What we drop:** the service split, RabbitMQ, the Nexus immunity/authority
gate, and the JSON identity file (replaced by config + the existing vault).

## v2 lessons applied

- **Ignore bot/system messages; only accept designated channels** — avoids
  loops and noise (v2's `message.author.bot` + `isChannel` checks).
- **Threads are first-class** — a thread is its own conversation; the parent
  channel decides acceptance.
- **Degrade, don't fail** — a Discord outage must never block the core
  (v2 logged instead of throwing on login failure).
- **Transport identity is spoofable** — record provenance honestly; do not
  treat a Discord user id as verified identity.

## Slices

# [ ] M16a — Unified channel message model

- [ ] A `channel_messages` ledger: direction (`inbound`/`outbound`), channel
      (`discord`), external peer + channel/guild/thread ids, transport message
      id, body, attachments, provenance, and timestamps. Append-only.
- [ ] A `channel_deliveries` table: outbound intent + status
      (`pending → sending → sent | failed | abandoned`), attempt count, next
      attempt, external message id, error. The durable queue.
- [ ] Claims/beliefs are untouched: channel traffic is evidence, exactly like
      turn messages — extraction still decides what, if anything, becomes memory.

# [ ] M16b — Channel adapter boundary + delivery service

- [ ] A `ChannelAdapter` interface (connect/disconnect/health; `send`; inbound
      is pushed to a handler). One adapter per channel; core depends on the
      boundary, never on discord.js directly.
- [ ] `ChannelDeliveryService`: drains the delivery queue, rate-limits per
      channel, retries with bounded backoff, records terminal state. Never
      blocks a turn; fail-soft like extraction/promotion.

# [ ] M16c — Discord adapter (outbound first)

- [ ] discord.js client behind the boundary (intents: Guilds, GuildMessages,
      MessageContent, DirectMessages), token resolved via env **or** the vault.
- [ ] Outbound rendering: split at Discord's message limit, attachments as
      links, plain text. (Token streaming / edit-in-place is optional; default
      is send-on-complete.)
- [ ] Connection lifecycle + degraded state surfaced on `GET /core/channels`.

# [ ] M16d — Inbound Discord → an ICOS turn

- [ ] On `MessageCreate`: ignore bots/system; accept only designated channels
      (topic marker or allowlist) and their threads; DMs per policy.
- [ ] Map to a durable session/conversation: `discord:<guild>:<channel>`
      (thread-aware), so continuity and recall work across turns and restarts.
- [ ] Run a turn through `ConversationService`; route the reply back to the
      originating channel/thread via M16b. Memory extraction runs as usual.
- [ ] Idempotency: a repeated transport message id must not double-run a turn.

# [ ] M16e — Outbound initiation

- [ ] Agent tools (e.g. `channel.send` / `discord.send`) — model-invoked,
      **approval-gated** through the existing M6/M8 machinery, logged.
- [ ] An HTTP API (`POST /core/channels/messages`) for human/scripted sends.
- [ ] Both paths write M16a records and enqueue M16b deliveries. Recipients are
      constrained by the M16g allowlist, not free-form.

# [ ] M16f — Approvals in Discord

- [ ] Surface pending approvals in the designated approval channel with
      ✅/❌ buttons (v2 parity); button press submits the decision through the
      existing approvals API, then edits the message.
- [ ] Button custom-ids carry the approval + session ids; the decision is
      authorised by the same rules as the web client (no model text approval).

# [ ] M16g — Identity, permissions, and secrets

- [ ] Operator-only: an allowlist of Discord users/guilds/channels; unmapped
      or disallowed senders are ignored and recorded, never answered.
- [ ] Map an allowed Discord user to the single-user persona seam
      (`DEFAULT_PERSONA_USER_ID`); honest provenance (`authTrust: transport`).
- [ ] The bot token and (M16.1) Brevo key resolve through the **secret
      resolver** (`$VAR` or `secret:NAME`), so they can be set — never viewed —
      from the existing web **Server settings** vault tab. Add to `.env.sample`.

# [ ] M16h — Verification

- [ ] Unit + e2e with a mocked Discord adapter (inbound maps to a turn and
      replies; outbound enqueues, sends, and records status; retries work;
      allowlists block; idempotency holds; degraded mode is honest).
- [ ] **Live:** with a real bot token, a message from Discord produces a real
      reply, and an assistant-initiated send is delivered — evidence committed.

# [ ] M16.1 — Email (Brevo) *(separate slice)*

- [ ] A second `ChannelAdapter` (Brevo transactional API): outbound send with a
      verified sender; inbound later or absent. Same message model, delivery
      ledger, secret handling. Kept separate because Discord alone is already a
      full milestone.

## Scope boundary

- **SMS:** dropped (no viable free tier).
- **Email:** deferred to M16.1.
- **No separate service / no broker:** channels live inside `core`.
- **No proactive/unprompted sends:** the agent sends as part of a turn or an
  approved action; event-triggered autonomous messaging is M20.
- **No multi-user identity mapping:** operator-only (single-user seam).
- **No attachment download/processing:** record metadata + URLs only.
- **No model-facing "read the whole server":** only designated channels/DMs the
  allowlist permits.

## Open decisions

1. **Channel designation:** v2's topic marker `[icos-stream: chat]`
   (self-configuring, no env) vs a config allowlist of channel ids
   (explicit, no server edit). *Lean: marker, with a config fallback.*
2. **Streaming to Discord:** send-on-complete (simpler, fewer rate-limit
   issues) vs edit-in-place token streaming (nicer, more API calls).
   *Lean: send-on-complete first.*
3. **Tool naming/shape:** one generic `channel.send` vs per-channel
   `discord.send` / `email.send`. *Lean: generic `channel.send` with a channel
   arg; per-channel tools can be aliases later.*
4. **Approval channel:** reuse chat channel vs a dedicated `approval` stream
   channel. *Lean: dedicated stream, falling back to chat.*
5. **DM policy:** accept DMs from allowlisted users only (default) vs disabled.

## Definition of Done

M16 is complete when ICOS can demonstrate:

> An operator talks to the agent from Discord and gets a grounded reply that
> carries the same memory and identity as the web client; the agent (or an
> API caller) can send an outbound message that is recorded, delivered, and
> retried on failure; pending approvals surface in Discord and can be decided
> there; disallowed senders are ignored; the bot token is vault-settable and
> never logged; and Discord being down never blocks the core — all with
> committed unit, e2e, and **live** evidence, and clean `tsc`/`eslint`.
