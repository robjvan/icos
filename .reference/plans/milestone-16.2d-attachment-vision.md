# M16.2d — Attachment vision (images to the model)

> Status: **done / verified** (2026-10-07). Sub-slices **M16.2d.1–.4**
> implemented and live-verified (inline + fallback). Evidence:
> `.reference/plans/evidence/milestone-16.2d/attachment-vision-evidence.md`.
> Follow-on to M16.2 (attachments). Captured 2026-10-04. Sequenced *after* the
> EXP tool-surface work — `vision_analyze` (M17b.8) is the text-only fallback
> rather than a special case. Crosses the **LLM protocol boundary**.

## Decision (2026-10-04)

- **Both paths, auto-routed** (Hermes parity): inline base64 when the active
  conversation model is vision-capable; otherwise an auxiliary **vision** model
  produces a text description injected into the turn.
- **No object store.** Images are base64-encoded in memory — local store for
  web uploads, CDN fetch for Discord. Nothing is hosted and no URLs are passed
  to the model, so no S3/versitygw dependency.
- **The auxiliary vision model is a `vision` provider role.**
  *Resolved (2026-10-04):* switching the memory model to the **native Ollama
  `gemma4:e4b`** (projector packaged) reports
  `capabilities: ["completion","vision","audio","tools","thinking"]`, and a
  live probe (a 96×96 PNG → `/api/chat` with `images:[base64]`) returned
  *"A blue circle is placed on a red background."* — so the local model can
  serve the auxiliary vision path with no new dependency. (The earlier
  custom build `gemma4-e4b-mem:latest` lacked the `mmproj` and reported no
  vision.)
- **Depends on EXP-1 (tools):** `vision_analyze` is expected to arrive as a
  tool in the expansion, so this slice consumes it rather than inventing a
  bespoke path.

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

## Sub-slices (suggested, after EXP-1)

- **M16.2d.1** — content parts in the protocol + `AttachmentImageResolver`
  (local store) + inline path for a vision-capable conversation model; tests.
  Makes **web-uploaded images** visible.
- **M16.2d.2** — remote download for Discord CDN images + bounds; tests.
- **M16.2d.3** — the auto-route fallback: when the conversation model is
  text-only, invoke the `vision` model (via the `vision_analyze` tool from
  EXP-1) and inject the description; tests.
- **M16.2d.4** — live verification (web UI + Discord) + evidence; docs.

## Open questions

- **Provider support:** does the configured provider accept `data:` URLs for
  `image_url`? (Most OpenAI-compatible gateways do; verify live early.) If it
  only accepts http(s), web uploads would need a reachable URL instead of
  base64 — a different design.
- **Model capability — how ICOS learns it (answered 2026-10-04).** It is *not*
  reliably reported, so a **user-declared capability is the source of truth**:
  a `vision` flag on the provider entry (or the `vision` role's presence).
  Auto-detect is opportunistic only:
  - **Ollama** reports `capabilities` (incl. `"vision"`) via `/api/show` —
    reliable for local models. *(Finding: the configured
    `gemma4-e4b-mem:latest` reports `["completion","tools","thinking"]` — no
    vision. The auxiliary path needs a vision-capable model.)*
  - **OpenRouter-style** gateways report `architecture.input_modalities`.
  - **Most OpenAI-compatible gateways** (incl. the current `opencode`
    endpoint — `/models` returns 404) report nothing.
  - **Local serving (resolved 2026-10-04).** A *custom* Ollama model can't
    bundle an `mmproj` (the multimodal projector), so it won't advertise
    vision. The native `gemma4:e4b` includes it: `/api/show` reports `vision`
    and a live `/api/chat` probe with an image succeeded. (Serving via
    llama.cpp with an explicit mmproj remains an option if a custom build is
    ever needed.)
  - **Container networking (fixed 2026-10-04).** The core container must reach
    the host Ollama at **`host.docker.internal:11434`** — `localhost` is the
    container itself. `MEMORY_LLM_BASE_URL` pointed at `localhost` and memory
    extraction was **silently failing** in Docker (`[ollama] LLM endpoint
    unreachable`). Fixed; verified by a turn that added new candidates
    (23 → 27). This affects both memory extraction and the future vision path.
  So: default to the declared flag; probe where the provider exposes it; fall
  back to the flag when the probe is unavailable. (Bundled future slice for
  capability detection **and** model listing:
  `.reference/plans/provider-model-discovery.md`.)
- **Cost/latency:** images are token-expensive; cap aggressively and note it.
- **History:** images are attached to the **current** user message only, never
  replayed from history (avoids re-sending bytes every turn). Confirm that is
  acceptable (the model loses the image on later turns unless re-attached).

## Evidence plan

Unit (protocol normalization incl. rejection cases; resolver bounds/fail-soft;
prepareTurn injects parts on both paths) + live (web UI and Discord: the model
describes an image it could not describe before).
