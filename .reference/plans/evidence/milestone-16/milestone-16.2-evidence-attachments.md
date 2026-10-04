# M16.2 — Attachments (inbound + web upload): Verification

> Status: **complete** (2026-10-04).
> Definition of Done (M16.2): a shared attachment model carried on a turn;
> inbound Discord attachments surfaced to the model; a bounded web upload
> endpoint; and the composer wired to it. Processing (download/vision/OCR) is
> a follow-on, not this slice.

## What was built

- **M16.2a — the turn carries attachments.** A neutral `TurnAttachment`
  (`conversation/attachments.ts`) and a bounded `<attachments>` band built by
  `buildAttachmentBand`: metadata only (name/type/size/url), capped at 10,
  long fields clipped, and `null` when there are none (so an attachment-free
  turn stays byte-identical). `ContextMemory` gains `attachmentBand`, rendered
  right after `sourceBand`; `converse()` takes `options.attachments`; the
  Discord ingress passes inbound attachment metadata through;
  `ConversationRequestDto` accepts up to 10 validated refs.
- **M16.2b — web upload + storage.** `AttachmentStore` writes files under the
  configured data dir (owner-only `0600` in a `0700` directory) with a JSON
  sidecar; names are sanitized and ids validated (no path escape).
  `AttachmentsController`: `POST /core/attachments` (multipart) with a size cap
  and MIME allow-list (`400`/`413`/`415`), and `GET /core/attachments/:id`
  serving the file. `AttachmentsModule` wired into `CoreModule`.
- **M16.2c — the composer.** `AttachmentService` + `CoreApiService.postForm`
  upload chosen files; the composer holds `File[]`, uploads on submit, and
  emits `{ message, attachments }`; on failure it keeps the message and files
  and shows an inline error. The submission threads composer → chat shell →
  store → stream service, which includes `attachments` in the POST body. The
  "server unimplemented" badge is gone.

## Unit + e2e

| Area | Spec | Count |
| --- | --- | --- |
| Attachment storage | `attachments/attachment.store.spec.ts` | 4 |
| Upload controller | `attachments/attachments.controller.spec.ts` | 5 |
| Attachment band | `conversation/attachments.spec.ts` | 4 |
| Band ordering | `conversation/context.builder.spec.ts` | +1 |
| Inbound carries attachments | `channels/discord-ingress.service.spec.ts` | +1 |
| End-to-end | `test/app.e2e-spec.ts` | +1 |

The e2e uploads a PNG, fetches it back, then sends a turn carrying the ref and
asserts the model receives the `<attachments>` band.

Totals after this slice: **1098 unit passed, 1 skipped** and **66 e2e passed**
(core); **187 web-client tests**; `tsc`/`eslint` clean on both.

## Live — web/API path

Upload + a turn carrying the reference (admin session, live):

```
POST /core/attachments  → 201
  { id: 82e18db4-…, name: live-check.txt, contentType: text/plain,
    sizeBytes: 32, url: /core/attachments/82e18db4-… }

POST /core/conversation { message: "What attachment arrived…? Describe its
metadata only…", attachments: [ …ref… ] }  → 200
```

The reply (verbatim):

> The message arrived with one attachment. Its metadata is:
> - **Name:** `live-check.txt` · **Type:** `text/plain` · **Size:** 32 bytes
>   · **URL:** `/core/attachments/82e18db4-…`
>
> That's the full metadata I have. The contents were not fetched, so I can't
> tell you anything about what's inside the file — only that a ~32-byte
> plain-text file named `live-check.txt` was attached.

The model describes the metadata and **explicitly refuses to claim it read the
contents** — the intended behaviour.

## Live — Discord inbound

A message with an image in the Boardroom reached the turn; the ledger recorded
it and the agent replied:

```
channel_messages: inbound
  conversation_key: discord:…:1500463773645934603:thread:1556342410513227997
  body: "<@…> Are you able to see the attached file"
  attachments_json: [{ name: "moi-v2.jpg", contentType: "image/jpeg",
                       sizeBytes: 335582, url: "https://cdn.discordapp.com/…" }]
```

> Partially — I can see that a file is attached, but not its contents.
> What I have: filename moi-v2.jpg, type image/jpeg, size 335,582 bytes, and a
> CDN URL. The attachment metadata came through as a reference only; the image
> itself was not fetched, and I have no vision/decoding of it this turn.

## Deployment finding (fixed)

`ATTACHMENTS_DIR_PATH` was not set in `core/.env`, so — like the channel DB
before it — uploads landed in `/root/.icos/data/attachments` *inside* the
container and were lost on rebuild. Fixed by setting it host-absolute
(`${HOME}/.icos/data/attachments`); re-verified on the host mount with `0700`
directory / `0600` files.

**Separate, pre-existing:** `VECTOR_DB_PATH` is also unset in `core/.env`, so
the claims vector DB likely defaults in-container too. Out of scope for M16.2
and flagged for follow-up.

## What M16.2 explicitly does not claim

- **No download, vision, OCR, or decoding** — metadata/reference only; the
  model cannot see file contents (and says so).
- **No retention/cleanup policy** yet for stored files.
- **No dedupe**; each upload is a new id. **One file per request.**
- Outbound attachment rendering (links to Discord) is not part of this slice.

## Reproduce

```sh
cd core && npm test && npx jest --config test/jest-e2e.json --runInBand
cd ../web-client && CI=true npx ng test --watch=false && npm run lint
# live: POST /core/attachments (multipart 'file'), then POST /core/conversation
# with the returned ref in `attachments`; or send a file to the bot in Discord.
```
