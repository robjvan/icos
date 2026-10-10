# M20.6 — Context budget & compaction

> Status: **planned** (2026-10-10). Sub-milestone of **M20**. Source: the
> ChatGPT notes in `.reference/notes/m20-web-client-rollup.md` (M20l).

## Objective

Replace the fixed message-count window (`MAX_HISTORY`) with a **token budget**:
estimate the assembled context against the model's **usable** window, let the
operator set a target (e.g. 80%), and when the target is crossed, **summarize
older turns** while preserving recent turns and required structured sequences.
Keep the result inspectable and never re-trigger on the same oversized range.

## Context budget source — can we pull it from the provider?

**Mostly manual; auto-detect only where the provider exposes it.** Checked:

- ICOS has **no** context-window metadata anywhere today.
- The current provider (`opencode`, `https://opencode.ai/inference/go/openai/v1`)
  returns **404** on `/models` — it does not advertise a context length.
- Some providers do expose it: OpenRouter's `/models` includes `context_length`;
  Ollama's `/api/show` returns `num_ctx`/`context_length`.

So the design is **manual-first, auto-detect best-effort**:

- `LLM_CONTEXT_WINDOW` (manual, default `131072`) — the advertised max.
- `LLM_MAX_OUTPUT_TOKENS` (manual, default `8192`) — reserved for the reply.
- **Usable budget** = `LLM_CONTEXT_WINDOW − LLM_MAX_OUTPUT_TOKENS − safety`
  (the system prompt, tool schemas, and memory bands are then measured against
  the remainder, not assumed free).
- **Optional probe** (best-effort, never fatal): on startup, if
  `LLM_CONTEXT_WINDOW` is unset, try `/models` (`context_length`/`max_model_len`)
  and, for an Ollama base URL, `/api/show` (`num_ctx`). If found, adopt it and
  log; otherwise fall back to the default. For `opencode` this simply falls back.

## Design

### 1. Token accounting
Reuse the existing `estimateTokens(text) = ceil(len / 4)` (`memory/prompt-bands.ts`)
with a small per-message overhead and a safety factor. It is a heuristic —
documented as such; the budget is deliberately conservative. (A real tokenizer
is a future option, provider-specific.)

### 2. Budget & trigger
```
usable   = contextWindow - maxOutputTokens
trigger  = usable * compactionTarget        (default target 0.8)
```
After `buildContext` assembles the turn (system prompt + catalog + skill bodies +
bands + history + user message + tool schemas), estimate its tokens. If
`estimate > trigger`, compact **before** the LLM call.

### 3. Compaction
Summarize the **oldest** turns into one bounded "conversation summary" band,
keep the most recent turns verbatim:
- Preserve recent turns (a configurable floor, e.g. the last N turns or a token
  slice) so continuity and tone survive.
- Never split a **tool-call / tool-result** pair; structured sequences stay
  valid (the summary covers whole turns only).
- The **transcript is untouched** — compaction is context-only, evidence is
  never destroyed (same rule as `/undo`).
- Summarize via an LLM call using the **memory** provider role when configured
  (cheap/fast), else the conversation model. Bounded prompt; fail-soft — a
  failed summary degrades to the existing window rather than failing the turn.

### 4. Inspectable
Persist each summary so the operator can see what the model was told:
`context_summaries(session_id, summary, covered_upto_message_id, token_estimate,
created_at)`. Surface it in `/status` and a client view (the Memory tab or a new
"Context" segment), and in the `status` command's `data`.

### 5. Re-trigger guard
Store `covered_upto_message_id`; the next compaction only covers messages after
it, and only when the estimate crosses the trigger again. The same oversized
range is never re-summarized (the "avoid repeatedly triggering" requirement).
Recompute the estimate after compaction and record the before/after in the turn
trace.

### 6. Settings
- Global: `CONTEXT_COMPACTION_ENABLED` (default true),
  `CONTEXT_COMPACTION_TARGET` (default 0.8, clamped 0.5–0.95),
  `LLM_CONTEXT_WINDOW`, `LLM_MAX_OUTPUT_TOKENS`.
- Client: a **Client settings** control (target slider + a read-out of the
  resolved window/usable budget), written via a small settings endpoint.

### 7. Relationship to `MAX_HISTORY`
`MAX_HISTORY` becomes a **hard cap** (a safety bound), not the primary limiter —
the token budget decides. A very long single message still cannot blow the
window because the hard cap and the per-message bound remain.

## Slices

- **M20.6.1 — Budget & accounting.** Config fields; a `ContextBudgetService`
  (usable budget, estimate, trigger); optional provider probe; `/status` shows
  the resolved window + estimate. No behaviour change until the trigger exists.
- **M20.6.2 — Compaction.** `ContextCompactionService` (summarize older turns,
  preserve recent + tool sequences), the `context_summaries` table, the turn
  hook, fail-soft.
- **M20.6.3 — Inspectable + settings.** Surface the summary (`/status`, API,
  client), the target setting + Client-settings control.

## Verification plan

- **Unit:** budget math (usable/trigger), estimate, trigger boundary;
  compaction covers whole turns and never splits a tool pair; the re-trigger
  guard (same range not re-summarized); fail-soft on summary error; the client
  setting round-trips.
- **Integration:** a synthetic long session crosses the target → one summary is
  written, the context shrinks below the trigger, and the transcript is
  unchanged.
- **Live:** a long conversation compacts once; `/status` (and the client) show
  the summary + before/after estimates; the transcript still shows every turn.

## Decisions (confirmed 2026-10-10)

1. **Summarizer model:** the **memory** role when configured, falling back to the
   conversation model. (Operator left this to the recommendation.)
2. **Target setting:** **global only** — `CONTEXT_COMPACTION_TARGET` (default
   0.8) in config + the Client settings tab.
3. **Surface:** a new **"Context" segment** in the Memory tab (summary text +
   before/after estimates), plus the numbers in `/status` and the Client
   settings read-out.
