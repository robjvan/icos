# FG6 — Model-aware context window (with auto-detect)

> Status: **planned** (2026-10-17). Source: release-1.0 exit criteria, item
> **FG6** (`.reference/notes/release-1.0-exit-criteria.md`). Supersedes the
> earlier "auto-detect is out" deferral — the operator wants the full version
> in 1.0.

## Problem

The conversation context window is a global constant that cannot follow the
model:

- `config.llmContextWindow` defaults to `1_000_000` (`config.ts:519`), so it is
  never unset.
- `ContextBudgetService` adopts it verbatim
  (`resolvedWindow = config.llmContextWindow ?? 1_000_000`, `context-budget.service.ts:50`).
- The provider probe that would notice the real window is off by default
  (`CONTEXT_WINDOW_AUTODETECT=false`) and, per the M20.6 plan, was meant to run
  only when the env was *unset* — which never happens because the config always
  supplies a default.

Switching to a 16K model therefore leaves the budget at 1M: compaction never
fires against the model's real window, and the Context panel reports a false
number.

## Goal

The resolved window reflects the configured model, a model switch updates it,
and there is never a silent stale default.

## Design

**Resolution order** (first hit wins), for the conversation role:

1. **Provider catalog `contextWindow`** — the active provider's declared window
   (model-specific).
2. **`LLM_CONTEXT_WINDOW`** env — explicit global override.
3. **Auto-detect** — probe the active endpoint: OpenAI-compatible `/models`
   (`context_length` / `max_model_len`); Ollama `/api/show` (`num_ctx` /
   `model_info.*.context_length`).
4. **Conservative default `16384`** + a WARN naming the setting.

Re-resolve whenever the active provider changes (the registry signals), so a
Models-tab switch takes effect without a restart. Expose the resolved window
**and its source** (`provider` | `env` | `probe` | `default`).

`LLM_CONTEXT_WINDOW` becomes optional; `CONTEXT_WINDOW_AUTODETECT` defaults on
(explicit `false` disables the probe).

## Surfaces

- `core/src/providers/provider-catalog.ts` + `dto/provider.dto.ts` + the Models
  tab: a `contextWindow` field.
- `core/src/providers/provider-registry.service.ts`: active entry, change
  listeners, status field.
- `core/src/conversation/context-budget.service.ts`: resolution, source, probe
  (with Ollama), re-resolve.
- `/core/context` settings + the Context panel: show the source.
- `.env.sample`, `docs/usage.md`, `docs/model-lineups.md`: document.

## Exit criteria

- The resolved window/budget reflects the configured model, never a stale
  default.
- Proof: unit + e2e + a live run showing resolved values after a model switch.
