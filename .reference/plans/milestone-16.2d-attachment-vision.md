# M16.2d — Attachment vision (images to the model)

> Status: **planned / not started**. Follow-on to M16.2 (attachments). Captured
> 2026-10-04. Not "huge", but it crosses the **LLM protocol boundary**, so it
> gets its own slice rather than a rushed patch.

## Why

M16.2 made attachments *usable as references*: the model is told a file
arrived (name/type/size/url) and correctly reports it cannot see the contents.
The configured model is expected to support **image input**, so the next step
is to actually send image bytes with the turn. Today it can't, because:

- The turn only builds an `<attachments>` metadata band.
- `ChatMessage.content` is `string` and `ToolOffer.messages()` rejects any
  non-string content — there is no multimodal path at all.

## Objective / DoD

An operator submits an image (web UI or Discord) and the model **sees it** —
it can describe/answer about the image content — while non-image attachments
stay metadata-only, and everything is bounded (size, count, MIME) and
fail-soft.

## Design

1. **Multimodal content parts (LLM layer).**
   - `ChatMessage.content: string | readonly LlmContentPart[]`, where
     `LlmContentPart = { type:'text'; text } | { type:'image_url';
     image_url:{ url } }` (OpenAI-compatible).
   - `ToolOffer.messages()` normalizes array content for **user** messages
     only (assistant content stays string|null); validates part shapes and
     bounds (parts count, text length, image-url length).
   - Responses are still text-only (`CompletionParser` unchanged).
2. **Image resolver.**
   - `AttachmentImageResolver.resolve(attachments) → LlmContentPart[]`.
   - Local (`/core/attachments/<id>`): read from `AttachmentStore`.
   - Remote (`https://…`, Discord CDN): download with a timeout, bounded.
   - Encode as `data:<mime>;base64,…`. Only image MIME types; fail-soft (a
     bad/oversized image is skipped and logged, never fails the turn).
3. **Turn wiring.** `prepareTurn` resolves images and attaches them to the
   final user message: `content = [{type:'text',text}, ...imageParts]`. Covers
   both the non-stream and **stream** paths (the stream path is what the web
   client uses — the M16.2 bug that dropped attachments lived here).
4. **Config.** `LLM_VISION_ENABLED` (default **true**; set false for a
   non-vision model, which otherwise errors on image turns). Document in
   `.env.sample`.

## Bounds / security

- Image MIME allow-list: `image/png|jpeg|gif|webp`.
- `MAX_IMAGES` per turn (e.g. 4), `MAX_IMAGE_BYTES` each (e.g. 4 MiB), and a
  total budget; skip (don't fail) anything over.
- Remote fetch: `https?` only, timeout (~10 s), size-capped by
  `Content-Length` and by the read itself; never a redirect to a non-http
  scheme.
- The resolver never reads arbitrary local paths — only ids that resolve
  through `AttachmentStore` (which already validates ids).
- No non-image content is ever inlined; no OCR in this slice.

## Sub-slices (suggested)

- **M16.2d.1** — content parts in the protocol + `AttachmentImageResolver`
  (local store) + wiring; tests. This alone makes **web-uploaded images**
  visible.
- **M16.2d.2** — remote download for Discord CDN images + bounds; tests.
- **M16.2d.3** — live verification (web UI + Discord) + evidence; docs.

## Open questions

- **Provider support:** does the configured provider accept `data:` URLs for
  `image_url`? (Most OpenAI-compatible gateways do; verify live early.) If it
  only accepts http(s), web uploads would need a reachable URL instead of
  base64 — a different design.
- **Model gating:** per-provider vision capability vs a single
  `LLM_VISION_ENABLED` flag (multi-role providers exist: conversation/memory).
- **Cost/latency:** images are token-expensive; cap aggressively and note it.
- **History:** images are attached to the **current** user message only, never
  replayed from history (avoids re-sending bytes every turn). Confirm that is
  acceptable (the model loses the image on later turns unless re-attached).

## Evidence plan

Unit (protocol normalization incl. rejection cases; resolver bounds/fail-soft;
prepareTurn injects parts on both paths) + live (web UI and Discord: the model
describes an image it could not describe before).
