# FG9c — Live context-usage gauge: evidence

> Status: **verified** (2026-10-17). Release-1.0 exit criteria context view.
> Plan: `.reference/plans/fg9c-provider-model-switcher.md` (the gauge is the
> "window health" companion to the switcher).

## Design

The turn loop already estimates the assembled context against the compaction
trigger, then discards it. The gauge keeps that number and shows it.

- `ContextBudgetService` records the last assembled-context estimate per session
  (`recordUsage` / `usageFor`), a bounded in-memory cache — a live view, not
  persisted state. It is the **same number the compaction decision acts on**, so
  the gauge matches what the runtime does.
- `conversation.service.ts` records it after context assembly (post-compaction).
- `GET /core/context/usage?sessionId=` returns `{ usedTokens, settings }`;
  `GET /core/context/summary` also carries `usedTokens`.
- `ContextGauge` (SVG donut, no new deps): used vs. usable, green under the
  trigger, amber past it, red at the budget, idle with no turn yet. Shown at
  `size="lg"` in the Context panel and `size="sm"` as a chat-header chip placed
  between the **ICOS** label and the session title (ties it to the session).

## Unit

Core **1288 passing** (2 pre-existing `persona-drift-corpus` failures,
unrelated). Web **208 passing** (52 files). `tsc` and `eslint` clean (both
packages).

New coverage: `context-budget.service.spec` (record/read usage), `context-gauge.spec`
(percent + tone thresholds + idle), `context-panel.spec` (renders the gauge
percentage), `models-tab.spec` (vault-on-paste).

## E2E

Core e2e **74 passing** — the context e2e now asserts `usedTokens > 0` after a
real turn via `GET /core/context/usage`.

Also fixed in this slice: the persona + hallucination e2e suites booted
`CoreModule` without an `AUTH_DIR_PATH` override, so they resolved the operator's
real `~/.icos/auth/secrets.vault` and failed closed once any vault secret
existed. Both now point at a temp auth dir (committed separately, `5d7d8f4`).

## Live run

Booted the real core against a stand-in provider advertising a 16K window, ran a
real turn, then read the usage:

```
usage (unknown session): {"usedTokens":null,"settings":{"contextWindow":16384,"contextWindowSource":"probe","usableTokens":8192,"triggerTokens":6553}}
POST /core/conversation -> 200
usage after turn: {"usedTokens":40,"settings":{"contextWindow":16384,...,"usableTokens":8192,"triggerTokens":6553}}
```

An unknown session reads `null`; a real turn records the estimate (40 tokens),
so the gauge shows usage against the resolved budget.

## Verdict

**Pass** — the current context-window state is now visible: a detailed gauge in
the Context panel and an at-a-glance chip in the chat header, both tied to the
session and updating each turn.

## Remainder

- The gauge reflects the **last assembled turn**, not a live re-estimate between
  turns (the honest number the runtime acts on).
- The usage cache is in-memory and bounded; it resets on restart (a live view,
  not history).
