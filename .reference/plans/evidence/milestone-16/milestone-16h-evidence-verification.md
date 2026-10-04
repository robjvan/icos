# M16h — Discord External Communication: Verification

> Status: **complete** (2026-10-04).
> Definition of Done (M16): an operator talks to the agent from Discord and
> gets a grounded reply that carries the same memory and identity as the web
> client; the agent (or an API caller) can send an outbound message that is
> recorded, delivered, and retried on failure; pending approvals surface in
> Discord and can be decided there; disallowed senders are ignored; the bot
> token is vault-settable and never logged; and Discord being down never
> blocks the core — all with committed unit, e2e, and **live** evidence, and
> clean `tsc`/`eslint`.

This slice is verification, not new mechanism. Every claim below is backed by
a committed test, a command that was run, or a live observation.

**Scope note.** M16 is **Discord**. Email via Brevo is the separate slice
**M16.1** (the local env already holds `BREVO_API_KEY` / `BREVO_SENDER_*`; the
`ChannelAdapter` is not built yet) and is intentionally *not* claimed here.

## Headline

| Check | Evidence | Result |
| --- | --- | --- |
| Storage + ledger | `sqlite-channel.repository.spec.ts` (8) | messages/deliveries persist, idempotent by `(channel, external_id)` |
| Durable outbound queue | `channel-delivery.service.spec.ts` (4) | claim → send → sent/failed, bounded backoff, abandon cap |
| Adapter boundary | `discord.adapter.spec.ts` (21) | send/edit/thread/DM, 2000-char split, degrade on bad token, ready + shutdown hooks |
| Inbound → a real turn | `discord-ingress.service.spec.ts` (18) | accept policy, idempotency, thread mapping, source band, errors visible |
| Outbound send paths | `channel-send.service.spec.ts` (2) + `channel-tool-sender.service.spec.ts` (5) | HTTP send + allowlist-resolved tool send |
| Approvals in Discord | `discord-ingress.service.spec.ts` (card post + button decision) | card with buttons, decision resumes the parked turn |
| Permissions + audit | ingress (guild allowlist, ignored-sender ledger) + `channels.controller.spec.ts` (2) | disallowed senders ignored **and recorded**; policy observable |
| Presence | `channel-presence.service.spec.ts` (8) + `discord.stream.spec.ts` (3) + adapter hooks | online once per boot via the queue; offline on graceful shutdown; live-verified |
| Live | container logs + `GET /core/channels` + ledger + operator | see §3 |

Totals on the recorded run: **1068 unit passed, 1 skipped** (the opt-in live
client spec) and **65 e2e passed**; `tsc` and `eslint` clean. The channel
subsystem alone is **71 tests across 9 suites**.

## 1. Unit — the mocked-adapter matrix

The "mocked Discord adapter" coverage lives in the unit suites (there is no
separate channel e2e spec; the app-level e2e drives the conversation surface
with a mocked LLM instead).

- **Inbound maps to a turn and replies** — `discord-ingress.service.spec.ts`
  drives `handle()` with a fake adapter and a fake `ConversationService`:
  a mention starts a thread and the `🤔 thinking…` placeholder is edited into
  the reply; a DM and a thread each map to one durable session; the reply is
  delivered in place.
- **Outbound enqueues, sends, and records status** —
  `channel-send.service.spec.ts` records the outbound message and enqueues a
  delivery; `channel-delivery.service.spec.ts` claims it, calls the adapter,
  and marks it `sent` (or `failed` with backoff).
- **Retries work** — `channel-delivery.service.spec.ts` proves the backoff
  schedule and that a delivery is abandoned after the attempt cap.
- **Allowlists block** — `discord-ingress.service.spec.ts` proves DMs from
  unlisted users, non-allowlisted guilds, and undesignated channels are
  rejected; `channel-tool-sender.service.spec.ts` proves the agent tool only
  resolves operator DM / allowlisted channels / allowlisted users.
- **Idempotency holds** — a repeated transport id runs the turn once and
  edits one reply.
- **Degraded mode is honest** — `discord.adapter.spec.ts` proves a bad token
  or a login failure leaves the adapter disconnected with a truthful
  `detail`, and `send()` throws "not connected" rather than pretending.
- **Auth-source honesty** — accepted inbound rows carry
  `authTrust: 'transport'` and the Discord user id; rejected rows carry
  `ignored: true` plus a reason.

## 2. E2E

`core/test/jest-e2e.json` — the full app boots against temp databases with a
mocked LLM and exercises the HTTP surface end to end.

```
Tests: 65 passed, 65 total
```

Two test-infra fixes landed during this pass (commit `2495fe3`):

- `app.e2e-spec.ts` now points `channelsDbPath` at a temp file and disables
  channel delivery, so an e2e app never opens the real
  `~/.icos/data/channels.db` or runs a delivery timer against it.
- The LLM/extractor mocks are reset with `mockReset()` (which also clears the
  `*Once` queue), so a test that queues more one-shots than it consumes
  cannot leak one into the next test.

**Known flake (pre-existing, not M16).** The e2e suite fails intermittently
(observed ~1 in 6–10 in-band runs) with an *unrelated* request returning
401/404 instead of the expected status —
`Conversation (e2e) › authentication (S2) › lists providers…` (401 vs 400),
`… › clarification creation validates options and sessions` (404 vs 400),
`… › promotes a candidate to a belief on approval plus sweep`. Each affected
test passes in isolation (10/10 for the clarification case). It touches no
channel code and predates this work; it is recorded here rather than papered
over.

## 3. Live — Discord end to end

Boot (container image built from `dev`, `docker compose up -d core`), health
`healthy`:

```
[Nest] 32 - 10/04/2026, 2:56:27 AM  LOG [DiscordAdapter] Discord ready: NigelAgent#5144
```

`GET /core/channels` (admin, live):

```json
{
  "channels": [{ "channel": "discord", "connected": true, "detail": "connected" }],
  "policy": { "allowDirectMessages": true, "allowedChannels": 1, "allowedUsers": 1, "allowedGuilds": 0 }
}
```

### Outbound delivered (API caller)

`POST /core/channels/messages` → `202` with `status: "pending"`; after the
queue drained, the ledger (`~/.icos/data/channels.db`) showed the recorded
message and a delivered delivery:

```
message  : outbound  discord:dm:426065605901156365  provenance {"source":"operator"}
body     : "ICOS live check — outbound send via POST /core/channels/messages (M16e/M16h evidence). ✅"
delivery : status=sent  attempts=1  external_message_id=1556137996376473621
```

### Inbound → grounded reply

An operator message from Discord ran a real turn (same session store, memory,
and persona seam as the web client) and the reply was delivered back to the
same DM. Captured live on 2026-10-04.

#### Captured ledger + transcript

`channel_messages` (the inbound turn, from `~/.icos/data/channels.db`):

```
direction       : inbound
conversation_key: discord:dm:426065605901156365
peer_id         : 426065605901156365
external_id     : 1556140618106019911
session_id      : a7e396ab-dd6e-40fa-8787-82730ebf15ea
provenance      : {"source":"discord","authTrust":"transport","guildId":null,
                   "channelId":"1556046286896107663",
                   "discordUserId":"426065605901156365"}
body            : "Hi again - sorry for all the little message but we're
                   building the discord interface and have to keep testing"
```

The turn's transcript in `sessions.db` (session `a7e396ab…`):

```
user      : Hi again - sorry for all the little message but we're building
            the discord interface and have to keep testing
assistant : No worries — small messages are fine. ...
```

Note: an interactive reply is delivered as an **in-place edit of the
`🤔 thinking…` placeholder**, so it has no separate `channel_messages` /
`channel_deliveries` row by design. Queued sends (API calls, tool sends) do
get ledger rows — see the outbound example above.

### Approvals in Discord

A Discord-origin turn that parks for approval posts an approval card with
**✅ Approve / ❌ Reject** buttons; pressing one submits the decision through
the same `ApprovalService` as the web client, resumes the parked turn, and
rewrites the card. Operator-observed live end to end (propose `channel.send`
→ card → Approve → the DM was sent and the card flipped to `✅ Approved`).

### Presence (M16m) — live-verified

Status channel: `DISCORD_STATUS_CHANNEL_ID` = the Exile Boardroom
(`1500463773645934603`). From the channel on 2026-10-04:

```
03:26:22  NigelAgent  ♻️ Gateway online — ICOS is back and ready.
03:26:31  NigelAgent  ⚠️ Gateway shutting down — the current task may be interrupted.
```

Online is enqueued through the durable queue on `ready` (once per process
start, reconnect-guarded); offline is sent directly with a 2 s bound on
graceful shutdown. Unset is a silent no-op.

**Run-mode requirement found here.** The offline announcement needs
`onModuleDestroy` to run, which needs the signal to reach Nest. The Nest dev
watcher (`nest start --watch`) runs the app in a child process and swallows
SIGTERM/SIGINT, so the container now runs the compiled app as PID 1
(`CMD ["node", "dist/main"]`); hot reload is opt-in via
`CORE_COMMAND="npm run start:dev"`. See §4.5.

## 4. Defects found and fixed during verification

1. **The "durable" channel DB was not durable in the container.**
   `core/.env` set the session/memory/persona paths to the host-absolute
   `~/.icos` mount but omitted `CHANNELS_DB_PATH`, so the container wrote the
   ledger/queue to `/root/.icos/data/channels.db` — inside the container, off
   the bind mount, lost on every rebuild. Fixed by setting
   `CHANNELS_DB_PATH=${HOME}/.icos/data/channels.db` in the local env. The
   `.env.sample` already documented the variable.
2. **E2E opened the real channel DB.** `app.e2e-spec.ts` omitted
   `channelsDbPath` in its config override, so test apps opened the real
   `~/.icos/data/channels.db` and started a delivery timer against it. Fixed
   in `2495fe3`.
3. **Test `*Once` leakage.** `mockClear()` does not clear Jest's one-shot
   queue; switched to `mockReset()` + re-applied base implementations
   (`2495fe3`).
4. **Long replies exceeded Discord's limit.** A body over 2000 characters
   was sent whole and would be rejected — the M16c bullet "split at
   Discord's message limit" was not actually implemented. Fixed in
   `670c495`: `splitForDiscord` (newline → space → hard cut, exact
   reassembly) is now used by both `send` and `edit`.
5. **Graceful shutdown never ran in the dev container.** `enableShutdownHooks()`
   was present, but the Nest dev watcher (`nest start --watch`) runs the app in
   a child process and swallows SIGTERM/SIGINT, so `onModuleDestroy` never ran
   and the offline announcement never fired (confirmed: no shutdown logs, then
   no message in the channel). Fixed by making the container run the compiled
   app as PID 1 (`CMD ["node","dist/main"]`, with `npm run build` in the image);
   hot reload is opt-in via `CORE_COMMAND="npm run start:dev"`. Re-verified:
   the Boardroom shows the online message on boot and the shutdown message on
   `docker compose stop`.

## 5. What M16 explicitly does not claim

- **Email (Brevo)** is M16.1, not built here.
- **SMS** is dropped (no viable free tier).
- **No proactive/unprompted sends** — the agent sends within a turn or an
  approved action; event-triggered autonomous messaging is M20.
- **No multi-user identity mapping** — operator-only, single-user
  (`DEFAULT_PERSONA_USER_ID`).
- **Blocking pre-send mitigation**, **attachment download/processing**, and
  **model-facing "read the whole server"** are out of scope.
- A hard `SIGKILL` sends no shutdown announcement — an honest limitation.

## Reproduce

```sh
# deterministic unit + e2e
cd core && npm test && npx jest --config test/jest-e2e.json --runInBand

# live
docker compose up --build -d core
# read the bot token from the vault/env, then:
#   POST /core/auth/login {token}   → cookie + icos_csrf
#   GET  /core/channels             → connected + policy
#   POST /core/channels/messages    → outbound send (x-icos-csrf)
# message the bot in Discord       → grounded reply in the same channel/DM
```
