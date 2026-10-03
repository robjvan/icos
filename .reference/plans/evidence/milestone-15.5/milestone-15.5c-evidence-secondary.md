# M15.5c Evidence — Secondary-Model Verification

**Date:** 2026-10-03. **Scope:** a second model adjudicating high-stakes
claims, tiered and provider-agnostic. No mitigation (M15.5d). No Nest wiring
into the turn path yet.

## Decision: the verifier is an abstraction with pluggable backends

Jev is a **typed decision model**, not a chat model: it needs block
attention and a per-option verdict readout, and stock llama.cpp/Ollama
"cannot produce the decision scores." So it does **not** fit the
OpenAI-compatible S4 provider boundary. Instead, the verifier has two
backend *shapes*, selected by config and tried in order:

| tier | backend | config | what it is |
| --- | --- | --- | --- |
| 1 (preferred) | `decision` | `HALLUCINATION_DECISION_URL` | `POST /v1/systemone` — local Jev-style **or** any Jev-compatible server (same client, different URL) |
| 2 (fallback) | `llm` | `HALLUCINATION_VERIFIER_PROVIDER` | an OpenAI-compatible model via the S4 registry (the already-loaded local gemma4 in a verifier role) |
| 3 | none | — | deterministic claim/evidence checks only |

Local vs cloud decision model is therefore **one code path** — a different
`baseUrl` — not two integrations.

## What landed

- **`SystemoneVerifier`** (`systemone-verifier.service.ts`): sends one
  typed `choice` question (`supported` / `contradicted` / `unknown`) with
  the claim and evidence summary, and maps the calibrated probabilities to
  a verdict. Optional bearer from `HALLUCINATION_DECISION_API_KEY_REF`
  (`$VAR`/`secret:NAME`). Fails closed (unavailable) on any error.
- **`LlmVerifier`** (`llm-verifier.service.ts`): a strict one-word prompt
  through `RegistryService.endpointForId(id)` (new registry method, no env
  fallback), tolerant label parsing.
- **`ClaimVerifierService`** (`claim-verifier.service.ts`): the tiered
  composition with the deterministic classifier. Only high-stakes
  assertions are verified (asserted confidence ≥ 0.8). A verifier never
  auto-resolves — disagreement is recorded; with no verifier a high-stakes
  unresolved assertion is flagged `unverifiable_high_stakes`.
- **Independence labeling** (`verification.support.ts`): a verdict records
  `independent` when the verifier model differs from the speaker and `self`
  when it is the same model — so self-consistency is never written up as
  independent verification.
- **Config / env**: `HALLUCINATION_DECISION_URL`,
  `HALLUCINATION_DECISION_API_KEY_REF`, `HALLUCINATION_VERIFIER_PROVIDER`,
  `HALLUCINATION_VERIFIER_TIMEOUT_MS`.

## Verification

- **976 unit green** (13 new): systemone maps a choice + probability to a
  verdict, fails closed on HTTP error/throw, and sends a bearer when the
  key resolves; the LLM verifier parses labels, records `self` vs
  `independent`, and fails closed; the tiered service prefers `decision`,
  falls back to `llm`, flags `unverifiable_high_stakes` when none exists,
  skips low-stakes claims, and records disagreement without rewriting.
- **`tsc` / `eslint` clean.**

## Deferred (recorded)

- **Packaging:** the Jev runtime is a **sidecar container** under a compose
  profile (`jev-style serve` serving `/v1/systemone`), model on the
  `~/.icos/models` volume — the end user runs compose, not `pip`. The
  binfiles already chain profiles, so this is additive.
- **Wiring:** the verifier is not yet invoked from the turn path; that is
  M15.5d (mitigation) and the turn integration.
- **Comparison matrix** (future evaluation, on labelled data): **jev-local
  · jev-cloud · llm-gemma4 · none** — accuracy, calibration, latency, and
  cost, to choose the default tier per deployment. (qwen dropped: gemma4
  already covers memory/vision/audio, so the LLM tier reuses it.)
