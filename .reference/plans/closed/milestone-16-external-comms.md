# ICOS v3 — Milestone 16: External Communication Integrations

> **Scope:** Discord (bidirectional) first; Email via Brevo as **M16.1**.
> SMS dropped (no viable free tier; not worth it). Grounded in the v2
> discord-bot under `.reference/legacy/discord-bot/`, adapted to the v3
> single-process core.
>
> **Status:** Discord (M16a–h, M16m) **complete 2026-10-04** — evidence at
> `.reference/plans/evidence/milestone-16/milestone-16h-evidence-verification.md`.
> **M16.1 Email (Brevo)** **complete 2026-10-04** — evidence at
> `.reference/plans/evidence/milestone-16/milestone-16.1-evidence-email.md`.
> **Open follow-on slice:** **M16.2 Attachments** (recorded but not usable; web
> upload endpoint absent).

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

# [x] M16a — Unified channel message model (complete 2026-10-04)

- [x] A `channel_messages` ledger: direction (`inbound`/`outbound`), channel
      (`discord`), external peer + channel/guild/thread ids, transport message
      id, body, attachments, provenance, and timestamps. Append-only.
- [x] A `channel_deliveries` table: outbound intent + status
      (`pending → sending → sent | failed | abandoned`), attempt count, next
      attempt, external message id, error. The durable queue.
- [x] Claims/beliefs are untouched: channel traffic is evidence, exactly like
      turn messages — extraction still decides what, if anything, becomes memory.

# [x] M16b — Channel adapter boundary + delivery service (complete 2026-10-04)

- [x] A `ChannelAdapter` interface (connect/disconnect/health; `send`; inbound
      is pushed to a handler). One adapter per channel; core depends on the
      boundary, never on discord.js directly.
- [x] `ChannelDeliveryService`: drains the delivery queue, rate-limits per
      channel, retries with bounded backoff, records terminal state. Never
      blocks a turn; fail-soft like extraction/promotion.

# [x] M16c — Discord adapter (outbound first) (complete 2026-10-04)

- [x] discord.js client behind the boundary (intents: Guilds, GuildMessages,
      MessageContent, DirectMessages), token resolved via env **or** the vault.
- [x] Outbound rendering: split at Discord's message limit, plain text.
      (Outbound attachments are out of scope — the send body is text; token
      streaming / edit-in-place is optional and defaults to send-on-complete.)
- [x] Connection lifecycle + degraded state surfaced on `GET /core/channels`.

# [x] M16d — Inbound Discord → an ICOS turn (complete 2026-10-04)

- [x] On `MessageCreate`: ignore bots/system; accept only designated channels
      (topic marker or allowlist) and their threads; DMs per policy.
- [x] Map to a durable session/conversation: `discord:<guild>:<channel>`
      (thread-aware), so continuity and recall work across turns and restarts.
- [x] Run a turn through `ConversationService`; route the reply back to the
      originating channel/thread via M16b. Memory extraction runs as usual.
- [x] Idempotency: a repeated transport message id must not double-run a turn.

# [x] M16e — Outbound initiation (complete 2026-10-04)

- [x] Agent tools (e.g. `channel.send` / `discord.send`) — model-invoked,
      **approval-gated** through the existing M6/M8 machinery, logged.
- [x] An HTTP API (`POST /core/channels/messages`) for human/scripted sends.
- [x] Both paths write M16a records and enqueue M16b deliveries. The agent
      tool constrains recipients to the M16g allowlist; the HTTP API is
      admin-only and trusts the operator's target.

# [x] M16f — Approvals in Discord (complete 2026-10-04)

- [x] Surface pending approvals in the originating conversation (thread /
      channel / DM) with ✅/❌ buttons; a button press submits the decision
      through the existing approvals API, then edits the card. (A dedicated
      approval channel was not needed — the card goes where the turn came from.)
- [x] Button custom-ids carry the approval + session ids; the decision is
      authorised by the same rules as the web client (no model text approval).

# [x] M16g — Identity, permissions, and secrets (complete 2026-10-04)

- [x] Operator-only: an allowlist of Discord users/guilds/channels; unmapped
      or disallowed senders are ignored and recorded, never answered.
- [x] Map an allowed Discord user to the single-user persona seam
      (`DEFAULT_PERSONA_USER_ID`); honest provenance (`authTrust: transport`).
- [x] The bot token resolves through the **secret resolver** (`$VAR` or
      `secret:NAME`), so it can be set — never viewed — from the existing web
      **Server settings** vault tab. Add to `.env.sample`. (The Brevo key is
      M16.1.)

# [x] M16h — Verification (complete 2026-10-04)

- [x] Unit + e2e with a mocked Discord adapter (inbound maps to a turn and
      replies; outbound enqueues, sends, and records status; retries work;
      allowlists block; idempotency holds; degraded mode is honest).
- [x] **Live:** with a real bot token, a message from Discord produces a real
      reply, and an assistant-initiated send is delivered — evidence committed.

# [x] M16.1 — Email (Brevo) *(complete 2026-10-04)*

- [x] A second `ChannelAdapter` (Brevo transactional API): outbound send with a
      verified sender; inbound later or absent. Same message model, delivery
      ledger, secret handling. Kept separate because Discord alone is already a
      full milestone.
- [x] `email:<address>` target; `channel.send` email/operator (first
      allowlisted recipient) and email/user (allowlisted, case-insensitive);
      `email/channel` rejected. Admin HTTP path stays trusted.
- [x] Secret-resolved `BREVO_API_KEY`; `BREVO_SENDER_EMAIL`/`_NAME`,
      `EMAIL_ALLOWED_RECIPIENTS`, `EMAIL_DEFAULT_SUBJECT`, `BREVO_API_BASE_URL`.
- [x] Live-verified: message delivered to the operator inbox (see evidence).
- [ ] *(follow-on, not this slice)* Inbound email; HTML; attachments; per-send
      subject.

# [ ] M16.2 — Attachments (inbound + web upload) *(added 2026-10-04)*

Attachments are **recorded but not usable**, and the web composer is a
frontend-only placeholder. Two live symptoms:

- **Discord:** `normalizeDiscordMessage` records an attachment's metadata
  (`name` / `contentType` / `size` / `url`) into
  `channel_messages.attachments_json`, but the ingress runs the turn with
  `message.content` only (`discord-ingress.service.ts` → `converse(content,…)`).
  The model sees the text and never the attachment — hence "it only saw the
  message".
- **Web:** `web-client/.../composer` lists selected files locally and badges
  them "local-only · server unimplemented"; it never sends them. There is **no
  upload endpoint** in `core` (no `FileInterceptor`/multipart anywhere), so a
  file has nowhere to go.

- [ ] Define a shared attachment model for a turn (reuse `ChannelAttachment`:
      name, mime, size, url/path, source) so a turn can carry attachments from
      any origin, not just Discord.
- [ ] **Inbound (Discord):** surface attachment metadata into the turn (at
      minimum a bounded `<attachments>` note so the agent knows what arrived,
      without dumping bytes into the prompt).
- [ ] **Web:** add a server upload endpoint (bounded size, mime allow-list,
      stored under the `~/.icos` data root, never world-readable) and make the
      composer include attachment refs in the conversation request.
- [ ] **Processing policy:** metadata/links first; optional download +
      provider-agnostic vision/OCR as a follow-on. No unbounded fetch; egress
      is explicit and auditable.
- [ ] **Outbound:** consider rendering attachment links to Discord (today the
      send body is text only).
- [ ] Tests: adapter/ingress carry attachments into the turn; upload endpoint
      enforces size/mime and fails safely; composer sends refs.

Open questions: storage layout/retention (per-session dir under `~/.icos`?),
what the model receives (a URL, an extracted-text summary, or image content for
a vision tier), and whether the shared model also covers M16.1 email.

# [x] M16m — Presence messages (boot / shutdown) *(queued last)* (complete 2026-10-04)

Hermes parity: announce when the bot comes up and when it goes down, so an
operator watching a channel sees the runtime's lifecycle.

- [x] On Discord **ready**, post an "online" message; on **graceful shutdown**
      (`onModuleDestroy`), post a "shutting down" message. Defaults:
      `♻️ Gateway online — ICOS is back and ready.` /
      `⚠️ Gateway shutting down — the current task may be interrupted.`
- [x] Destination: a designated **status/presence** channel — a topic marker
      `[icos-stream: status]` (extending the existing vocabulary) or
      `DISCORD_STATUS_CHANNEL_ID`. **Unset → send nothing** (no channel to
      announce into is a normal state, never an error).
- [x] **Boot** goes through the durable delivery queue (retried). **Shutdown**
      is sent directly with a short bounded timeout: the queue will not drain
      once the process is told to stop, so it is best-effort by nature. A hard
      kill (`SIGKILL`) sends nothing — an honest limitation, not a bug.
- [x] Requires **graceful shutdown**: `app.enableShutdownHooks()` in `main.ts`
      so `SIGTERM`/`SIGINT` run `onModuleDestroy` (currently absent — add it).
- [x] **Reconnect guard:** announce "online" once per process start, not on
      every gateway resume, so a network blip does not spam the channel.
- [x] Config: `DISCORD_PRESENCE_ENABLED`, `DISCORD_STATUS_CHANNEL_ID` (or the
      marker), and optional `DISCORD_PRESENCE_ONLINE` / `_OFFLINE` templates;
      documented in `.env.sample`.
- [x] Tests: a boot message is enqueued once on ready; a shutdown message is
      attempted on destroy; no status channel → nothing sent, no error.

## Scope boundary

- **SMS:** dropped for M16 (no viable free tier). Note: Brevo offers
  transactional SMS, so it could be revisited later — not in scope now.
- **Email:** deferred to M16.1.
- **No separate service / no broker:** channels live inside `core`.
- **No proactive/unprompted sends:** the agent sends as part of a turn or an
  approved action; event-triggered autonomous messaging is M20.
- **No multi-user identity mapping:** operator-only (single-user seam).
- **Attachment download/processing:** out of scope for the Discord milestone
  (metadata + URLs only); revisited in **M16.2**.
- **No model-facing "read the whole server":** only designated channels/DMs the
  allowlist permits.

## Decisions (resolved)

1. **Channel designation:** topic marker `[icos-stream: chat]`, with
   `DISCORD_ALLOWED_CHANNEL_IDS` as a config fallback. Implemented.
2. **Streaming to Discord:** send-on-complete; interactive replies edit the
   `🤔 thinking…` placeholder in place. Implemented.
3. **Tool naming/shape:** one generic `channel.send` (channel arg); per-channel
   tools can be aliases later. Implemented.
4. **Approval surface:** the pending approval is posted **in the originating
   conversation** (thread / channel / DM) — not a dedicated stream channel — so
   the decision sits next to the turn that needs it. Implemented (M16f).
5. **DM policy:** DMs accepted from allowlisted users only
   (`DISCORD_ALLOWED_USER_IDS`); `DISCORD_ALLOW_DMS=false` disables them.
   Implemented.

## Definition of Done

M16 is complete when ICOS can demonstrate:

> An operator talks to the agent from Discord and gets a grounded reply that
> carries the same memory and identity as the web client; the agent (or an
> API caller) can send an outbound message that is recorded, delivered, and
> retried on failure; pending approvals surface in Discord and can be decided
> there; disallowed senders are ignored; the bot token is vault-settable and
> never logged; and Discord being down never blocks the core — all with
> committed unit, e2e, and **live** evidence, and clean `tsc`/`eslint`.
