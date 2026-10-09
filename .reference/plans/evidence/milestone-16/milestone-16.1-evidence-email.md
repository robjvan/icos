# M16.1 — Email via Brevo: Verification

> Status: **complete** (2026-10-04).
> Definition of Done (M16.1): a second `ChannelAdapter` (Brevo transactional
> API) — outbound send with a verified sender, the same message model,
> delivery ledger, and secret handling. Inbound email is out of scope.

This slice adds a channel; the verification below is the committed
unit + live evidence.

## What was built

- **`EmailAdapter`** (`core/src/channels/email.adapter.ts`, `name: 'email'`)
  behind the existing `ChannelAdapter` boundary. Brevo is a stateless REST
  service, so there is no socket: `connect()` validates configuration, and
  the adapter fails soft — a missing key or sender leaves the channel
  disabled (`detail` says which), never fatal. The API key resolves through
  the shared **secret resolver** (`$VAR` / `secret:NAME`), exactly like the
  Discord token, so it can be set — never viewed — from the vault.
- **Target key `email:<address>`** (`parseEmailTargetKey`), with a strict
  address check that rejects whitespace/control characters (no header
  injection) and malformed addresses.
- **Config**: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`,
  `BREVO_API_BASE_URL`, `EMAIL_ALLOWED_RECIPIENTS`, `EMAIL_DEFAULT_SUBJECT`.
  Documented in `.env.sample`.
- **Wiring**: registered in `CHANNEL_ADAPTERS`, so the durable delivery
  queue (`ChannelDeliveryService`) drains email sends by `channel` and
  retries with backoff like Discord.
- **`channel.send` email targets** (`ChannelToolSender`): `email/operator`
  → the first allowlisted recipient; `email/user` → an allowlisted address
  (case-insensitive, canonical form returned); `email/channel` rejected
  (`email_has_no_channels`). The tool schema and validator already accepted
  `channel: 'email'`; only the target resolver changed. The admin HTTP path
  stays trusted, as with Discord.

## Unit

| Area | Spec | Count |
| --- | --- | --- |
| Email adapter | `email.adapter.spec.ts` | 10 |
| Tool target resolution | `channel-tool-sender.service.spec.ts` | 10 (5 email) |

`email.adapter.spec.ts` covers: disabled without a key / without a valid
sender (honest `health` detail; `send` throws "not connected"); the exact
Brevo payload (sender, `to`, subject, `textContent`) and returned message
id; secret-reference resolution; a custom subject and base URL; rejection of
a non-email key; a bounded, non-secret error on a non-2xx; a fail-soft
network error; and the address/target parser (injection, double-`@`,
missing domain).

Totals after this slice: **1083 unit passed, 1 skipped** and **65 e2e
passed**; channel subsystem **86 tests across 10 suites**; `tsc`/`eslint`
clean.

## Live — a real email delivered

**Account/sender preflight** (Brevo v3, `GET /account` and `GET /senders`):

```
account : "Exile Logic" <robjvan@gmail.com>  plan: free
senders : noreply@exilelogic.ca (active), contact@exilelogic.ca (active)
```

**Boot** (`docker compose`; both channels ready):

```
[Nest] 1  LOG [EmailAdapter]   Email channel ready (sender noreply@exilelogic.ca)
[Nest] 1  LOG [DiscordAdapter] Discord ready: NigelAgent#5144
```

**Send** — `POST /core/channels/messages` `{ channel:'email',
conversationKey:'email:robjvan@gmail.com' }` → `202 pending`; after the
queue drained, the ledger (`~/.icos/data/channels.db`) showed:

```
message  : outbound  email:robjvan@gmail.com  provenance {"source":"operator"}
delivery : status=sent  attempts=1
           external_message_id=<202610041541.13181292652@smtp-relay.mailin.fr>
```

Observed: the message **landed in the inbox** (`robjvan@gmail.com`), not the
spam folder — the sender is verified.

**Gotcha found during verification.** Brevo refuses API calls from an
unrecognised egress IP (`401 … unrecognised IP address … add the new IP
address`). The container egresses from the host's public IP, so that IP must
be authorized in Brevo (`app.brevo.com/security/authorised_ips`) — a one-time
setup step, not a code issue. A rotated ISP address caused the first 401.

## What M16.1 explicitly does not claim

- **No inbound email** (outbound-only for now).
- **Plain text only** — `textContent`; no HTML rendering, no attachments.
- **Fixed subject** (`EMAIL_DEFAULT_SUBJECT`, default `ICOS`); no per-send
  subject argument yet.
- The live send above used the **admin HTTP path**; the agent `channel.send`
  path is covered by unit tests (allowlist resolution) and shares the same
  send/ledger code.

## Reproduce

```sh
# deterministic
cd core && npm test
# live (after authorizing the host IP in Brevo and setting BREVO_* + EMAIL_ALLOWED_RECIPIENTS)
docker compose up --build -d core
# login, then POST /core/channels/messages {channel:'email', conversationKey:'email:<recipient>', body:'...'}
```
