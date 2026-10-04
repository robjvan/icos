# Provider & model discovery (future slice)

> Status: **planned / not started**. Captured 2026-10-04. Bundles **capability
> detection** with **model listing** so the frontend presents model options
> (opencode/hermes-style) instead of the operator typing exact model ids.

## Why

Today the operator hand-types `baseUrl` + `model`, and ICOS treats every
provider as uniform, text-only OpenAI-compatible transport. Two related gaps:

1. **Capability detection** — ICOS cannot tell whether a model accepts images
   (and, later, tools / thinking / context length). See M16.2d: a `vision`
   flag is the near-term source of truth.
2. **Model discovery** — there is no list of what a provider offers, so the
   operator must already know the exact model id.

opencode and hermes present a *set of model options*; matching that is the goal.

## Scope (to refine)

- **Capability record** per provider/model: vision first; tools/thinking/context
  later. Sourced from, in order of trust:
  1. **declared flags** (source of truth),
  2. **auto-detect** where the provider exposes it — Ollama `/api/show`
     `capabilities`; OpenRouter `/api/v1/models` `architecture.input_modalities`;
     llama.cpp (endpoint TBD — check `/v1/models`, `/props`, or an OpenAI-style
     `capabilities` field),
  3. a **one-time live probe** for ambiguous cases (e.g. does the gateway accept
     `data:` image URLs).
- **Model listing**: query the provider's models endpoint when it exists; cache
  it; fall back to manual entry when it doesn't.
- **Frontend**: a searchable model picker replacing/augmenting the free-text
  field, with capability badges (e.g. `vision`).
- **Storage**: where discovered models/capabilities live (`providers.json`
  vs a cache with TTL) and how it behaves offline.

## Open questions

- **Endpoint variance**: `/models` shapes differ wildly across gateways; how
  much to normalize vs surface raw?
- **llama.cpp**: does it expose the mmproj/vision modality via any endpoint?
  (Ollama does, via `/api/show`; llama.cpp is only needed for custom builds.)
- **Cache invalidation** and offline/air-gapped behaviour.
- **Relationship to S4 provider roles** (`conversation`/`memory`/`vision`):
  capabilities are per model, roles are per purpose.

## Relationship

- **Consumes/complements M16.2d** (vision flag now; auto-detect seam later).
- Frontend work overlaps the web-client provider-settings surface.
- Natural home for the "pick a model from a list" UX the operator asked for.
