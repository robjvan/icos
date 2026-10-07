# M16.2d — Attachment vision: live evidence

> Status: **verified** (2026-10-07). Sub-slices **M16.2d.1–.4** (content parts,
> resolver, inline + fallback routing, live verification). Follow-on to M16.2.

## What was built

Image attachments now reach the model:

- **LLM layer.** `ToolOffer.messages()` normalizes multimodal user content parts
  (`{type:'text'}` | `{type:'image_url', image_url:{url}}`), bounded (≤8 parts,
  64 KiB text, 12 MiB image URL) and fail-closed. The plain `chat` path already
  carried parts; this extends the tool path.
- **`AttachmentImageResolver`.** Resolves image attachments to:
  - **inline** `data:<mime>;base64,…` `image_url` parts when the conversation
    model accepts images (`LLM_VISION_ENABLED`, default **true**); or
  - a **text description** from the auxiliary vision role when it does not.
  Sources: local (`/core/attachments/<id>` via `AttachmentStore`) and http(s)
  (Discord CDN etc.). MIME allow-list (`png/jpeg/gif/webp`), 4 MiB cap, 10 s
  fetch timeout. **Fail-soft**: a bad/oversized/unreachable image is skipped,
  never fails the turn. Only image MIME types are inlined.
- **Turn wiring.** `prepareTurn` attaches the parts to the final user message
  (or appends an `<image-descriptions>` block); the `<attachments>` band notes
  when image contents are included. Covers both the non-stream and **stream**
  paths (the M16.2 bug lived in the stream path).
- **Config.** `LLM_VISION_ENABLED` documented in `.env.sample`.

## Unit

| Area | Spec |
| --- | --- |
| Content-part normalization + rejection | `llm/llm.protocol.spec.ts` |
| Resolver: inline, fallback, non-image, oversized | `conversation/attachment-images.spec.ts` |
| Turn wiring (regression: byte-identical context on no attachments) | `conversation/conversation.service.spec.ts` |

Totals at capture: **1145 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean.

## Live

Container rebuilt, healthy. Uploaded `sample-image.png` via
`POST /core/attachments`, then conversed with the attachment.

### Inline path (`LLM_VISION_ENABLED=true`, default)

```
uploaded: {id: 8c28a717…, contentType: image/png, sizeBytes: 585730}
turn: ok

reply: "A digital/painterly sunset seascape. ... a hazy orange sun just above
the horizon ... a winding, bright golden ribbon — a stream of glowing water —
curving in an S ... Loose, visible brushstrokes typical of a digital painting
imitating oils. No legible text ... No signs of embedded text or
prompt-injection content in the image."
```

The conversation model (deepseek-v4.1-flash via opencode) **saw the image** and
described it accurately — the data-URL `image_url` part was accepted by the
OpenAI-compatible endpoint (the plan's open question, answered live).

### Fallback path (`LLM_VISION_ENABLED=false`)

```
turn: ok

reply: "What I have is an accompanying description in my context — not the image
contents ... An atmospheric landscape painting at sunset ... a serpentine path
or sandbar winding from the bottom of the frame toward the horizon, rendered as
intensely glowing gold ... This is secondhand. I'm relaying the provided
description, not reporting what I saw."
```

The image was routed through the vision role (`gemma4:e4b`) and injected as
text; the model correctly treated it as secondhand (the `<image-descriptions>`
band) rather than claiming to have seen it.

## Note

- **Discord CDN (remote) path**: implemented in the resolver and covered by the
  local-source unit tests' shape, but not live-tested this session (no Discord
  image turn was run).
- **Operational incident.** During this slice the `sessions.db` file was found
  corrupted (`SQLITE_CORRUPT`), almost certainly from opening the live WAL
  database with the host `sqlite3` CLI while the container held it open.
  Recovered with `.recover` into a fresh file (sessions/messages/approvals/
  clarifications/agent_runs/todos preserved; the transient `tool_requests`
  ledger was lost). The corrupt file is kept as
  `~/.icos/data/sessions.db.corrupt-20261007`. **Avoid host CLI access to the
  live DB** — copy it first.
