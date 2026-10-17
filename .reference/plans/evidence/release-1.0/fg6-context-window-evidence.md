# FG6 — Model-aware context window: evidence

> Status: **verified** (2026-10-17). Release-1.0 exit criteria, item **FG6**
> (`.reference/notes/release-1.0-exit-criteria.md`). Plan:
> `.reference/plans/fg6-context-window.md`.

## Design

The conversation context window is now resolved from the configured model, in
order (first hit wins):

1. **Provider catalog `contextWindow`** — the active provider's declared window.
2. **`LLM_CONTEXT_WINDOW`** env — explicit override.
3. **Auto-detect** — probe the active endpoint: OpenAI-compatible `/models`
   (`context_length` / `max_model_len`); Ollama `/api/show` (`num_ctx` /
   `model_info.*.context_length`).
4. **Conservative default `16384`** + a WARN naming the setting.

Changes:

- `config.ts`: `LLM_CONTEXT_WINDOW` is now optional (no silent 1M default);
  `CONTEXT_WINDOW_AUTODETECT` defaults **on** (`false` disables the probe).
- `provider-catalog.ts` + `dto/provider.dto.ts`: a per-provider `contextWindow`
  field (validated; serialized by `toRawProvider`).
- `provider-registry.service.ts`: `activeEntry(role)`, `contextWindow` in the
  status report, and an `onChange` signal fired on every catalog reload.
- `context-budget.service.ts`: resolution + source tracking + re-resolve on
  provider change, with a supersede token so a slow probe of the old endpoint
  cannot overwrite a newer provider's window.
- `/core/context` settings and the web Context panel expose the window **and
  its source** (`provider` / `env` / `probe` / `default`); the Models tab gained
  the `contextWindow` field.
- The reply reserve is capped at half the window, so a small resolved window
  cannot produce a degenerate budget.

## Unit

Core **1285 passing** (2 pre-existing failures: `persona-drift-corpus.spec.ts`,
unrelated — a moved notes file). `tsc` and `eslint` clean.

New/updated coverage:

- `context-budget.service.spec.ts` — resolution precedence (provider → env →
  probe → default), source tracking, Ollama `/api/show` fallback, the
  reply-reserve cap, **and the superseded-probe race** (a slow probe must not
  overwrite a newer provider window).
- `provider-catalog.spec.ts` — accepts/round-trips `contextWindow`, rejects a
  non-positive one.
- `provider-registry.service.spec.ts` — `activeEntry`, the report field, and the
  `onChange` notification.
- `context-compaction.service.spec.ts` — updated for the new constructor.

## E2E

Core e2e **74 passing** (`npm run test:e2e`). The context e2e now asserts
`contextWindowSource: 'env'` alongside the pinned window.

Web client **203 passing**; `npm run build` and `npm run lint` clean.

## Live run

Booted the real core (`node dist/main.js`, temp data dir, `AUTH_ENABLED=false`)
against a stand-in provider advertising a **16K** window, with
`LLM_CONTEXT_WINDOW` unset, then performed a **runtime model switch** by adding
a catalog provider that declares `contextWindow: 32768` and activating it — no
restart:

```
BEFORE switch: {"contextWindow":16384,"contextWindowSource":"probe","maxOutputTokens":8192,"usableTokens":8192,"triggerTokens":6553,...}
PUT /core/providers/local32k -> 200
POST /core/providers/active  -> 200
AFTER switch:  {"contextWindow":32768,"contextWindowSource":"provider","maxOutputTokens":8192,"usableTokens":24576,"triggerTokens":19660,...}
```

Core log:

```
[ContextBudgetService] Context window: 16384 tokens (source: probe)
[ContextBudgetService] Context window: 32768 tokens (source: provider)
```

The stale-1M failure mode is gone: the window reflects the model (16K, detected
from the provider) and follows a model switch to the newly declared 32K window
without a restart.

## Verdict

**Pass** — the resolved window/budget reflects the configured model, never a
stale default; a runtime model switch re-resolves it. Satisfies FG6 as scoped.

## Remainder

- The probe is boot-time + on provider change; a provider that starts
  advertising a window later (without a catalog reload) is not re-probed.
- `LLM_CONTEXT_WINDOW` remains a global fallback; per-role windows (memory /
  vision) are not resolved (the budget is conversation-only).
- No live run against a real Ollama `/api/show` — that path is unit-tested with
  a mocked response (Ollama was not available during this run).
