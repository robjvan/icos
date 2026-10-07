# M17b — Image generation tool (`image_generate`): unit evidence + deferred live test

> Status: **unit-verified; live NOT run** (2026-10-07). Slice **M17b.9**
> (`image_generate`). Per-slice evidence; M17 itself is still in progress.
> **The live path is deliberately unverified** — no provider credits and no GPU
> hardware — and is recorded below as a required future test.

## What was built

A native, approval-free `image_generate` tool (`toolset: 'image'`). Provider-agnostic
and config-first:

- **Config**: `IMAGE_GEN_PROVIDER` / `_BASE_URL` / `_MODEL` / `_API_KEY` /
  `_TIMEOUT_MS` / `_OUTPUT_DIR`. The key may be a **literal** or a
  **`$VAR` / `secret:NAME` reference** resolved at call time through the secret
  resolver (so it can live in the vault). Documented in `.env.sample`.
- **`ImageGenService`**: OpenAI-compatible `/images/generations` backend
  (`response_format: b64_json`, with a `url` fallback), writes bytes under
  `<outputDir>/generated/<uuid>.png`, returns `{path, provider, model, bytes}`.
  8 MiB cap, timeout, code-only failures.
- **Unconfigured = unavailable.** The tool reports `image_gen_unavailable` — the
  executor maps `*_unavailable` to the `unavailable` failure code (this also
  improved the existing web_search-unconfigured case). **No fake success.**
- **ComfyUI** (workflow-file driven) is a documented follow-up.

## Unit

| Area | Spec |
| --- | --- |
| Validator (prompt required; optional `WxH` size) | `tool-registry.spec.ts` |
| Service: unconfigured, b64 generation + file write, secret-ref key, error | `image/image-gen.service.spec.ts` |
| Execution (generated → path; unconfigured → `unavailable`) | `tool-execution.service.spec.ts` |
| Offered-tool surface (16) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1139 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **16 tools**.

## Live — NOT RUN (deferred)

No image-gen provider credits and no GPU hardware yet, so this path was **not**
exercised end-to-end. The service is unit-tested against mocked HTTP only.

**Required future test** (when a backend is available):

1. **OpenAI-compatible**: set `IMAGE_GEN_PROVIDER=openai`,
   `IMAGE_GEN_BASE_URL=<endpoint>/v1`, `IMAGE_GEN_MODEL=<model>`,
   `IMAGE_GEN_API_KEY=<literal or secret:REF>`; rebuild; then
   `image_generate {prompt: "a teal square"}` and confirm a file appears under
   `~/.icos/workspace/generated/` and the ledger row is `succeeded`.
2. **ComfyUI** (preferred locally, once hardware allows): implement the
   workflow-file backend (`/prompt` → `/history/<id>` → `/view`), then repeat.
   Note: running ComfyUI and the ICOS `gemma4:e4b` model at once exceeds the
   current MacBook's RAM; a higher-RAM machine or a second machine is needed.

Until then, the tool honestly reports `unavailable` on an unconfigured
deployment, and its unit contract is the only verified behaviour.

## Note

The provider/key surface is exactly what the user asked for: configurable later
via `.env` or the vault, without hard-coding a provider.
