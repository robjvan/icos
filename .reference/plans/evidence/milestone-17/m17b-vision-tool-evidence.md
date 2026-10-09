# M17b — Vision tool (`vision_analyze`): live evidence

> Status: **verified** (2026-10-07). Slice **M17b.8** (`vision_analyze`). Per-slice
> evidence; M17 itself is still in progress.

## What was built

A native, approval-free `vision_analyze` tool (`toolset: 'vision'`) that routes an
image to an **auxiliary vision-capable model** and returns a text description — a
fallback / second opinion for a text-only (or differently-capable) chat model.

- **Vision role.** A `VISION_LLM_*` config role with its own `LlmClient`, falling
  back `VISION_* → MEMORY_* → LLM_*`. With the local `gemma4:e4b` as the memory
  model it serves vision with **zero extra config**. Documented in `.env.sample`
  (with the `host.docker.internal:11434` in-container note).
- **LLM layer.** OpenAI-compatible `LlmContentPart`
  (`{type:'text'}` | `{type:'image_url', image_url:{url}}`) and a multimodal user
  message; the plain `chat` path carries the parts through unchanged.
- **`VisionService` + `VisionLlmClient`.** Own endpoint; sends the image as a
  `data:<mime>;base64,…` URL and returns `{ text, model }`.
- **Tool.** `path` (workspace-confined) **or** `url` (http/s), exactly one. MIME
  allow-list (`png/jpeg/gif/webp`), 4 MiB cap, 10 s fetch timeout, fail-soft.

### Design notes

- **Secondary/backup by intent.** The tool always routes to the vision role, even
  when the chat model itself is vision-capable — so it works as a fallback and a
  "second opinion". The M16.2d auto-route (inline images when the chat model
  supports them) will reuse the same `LlmContentPart` plumbing.
- **Env-only role for now.** `VISION_LLM_*` mirrors `MEMORY_LLM_*`; a full
  provider-catalog `vision` role (vault `apiKeyRef`, UI switching) is a follow-up.
- **`image_generate` is separate.** No provider credits/hardware yet; that slice
  will be config + adapters with the live path documented as a required future
  test.

## Unit

| Area | Spec |
| --- | --- |
| Validator (exactly one of path/url; bounds) | `tool-registry.spec.ts` |
| Execution (workspace image → vision; unsupported type rejected) | `tool-execution.service.spec.ts` |
| Service (text + image parts; session id) | `vision/vision.service.spec.ts` |
| Offered-tool surface (15) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1132 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **15 tools**.

## Live

Container rebuilt (`docker compose build core && up -d core`), healthy. One turn:

```
user:  Use the vision_analyze tool on the workspace file 'sample-image.png'
       with the prompt 'Describe this image in detail.'

vision_analyze {path: "sample-image.png", prompt: "Describe this image in detail."}
  → succeeded, model gemma4:e4b, mime image/png

reply (chat model relaying the vision text): "A dramatic sunset over water, in a
romantic oil-painting / digital-art style. ... a bright luminous sun just above
the horizon ... a dark, wide path that appears lit from within ..."
```

The description matches the image (a sunset seascape with a glowing golden path),
so the local `gemma4:e4b` served the vision role correctly.

Durable ledger row:

```
tool_requests: state=succeeded  tool=vision_analyze
  result={path:"sample-image.png", mime:"image/png", model:"gemma4:e4b", text:"This is a highly dramatic ..."}
```

## Note

One tool call per step. The vision role was reached via the `MEMORY_LLM_*`
fallback (`gemma4:e4b` at `host.docker.internal:11434/v1`) with no `VISION_LLM_*`
set. `sample-image.png` (user-provided) was staged into the workspace; a copy
remains there as a test fixture.
