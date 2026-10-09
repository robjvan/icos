# M17d.3 — Browser (`browser`): live evidence

> Status: **verified** (2026-10-09). Slice **M17d.3**. Per-slice evidence; M17d
> is complete (computer_use deferred).

## What was built

An approval-free `browser` tool (`toolset: 'browser'`) over Playwright +
headless Chromium:

- **`BrowserService`**: one page per session, lazily launched, closed on
  shutdown. `playwright` is **lazy-imported**, so an unused browser never loads
  the heavy dependency.
- **Actions**: `navigate` (http/s only), `snapshot`, `click`, `type`, `scroll`,
  `screenshot` (writes a PNG under `<workspace>/browser/`). Bounded — 20 s
  navigation timeout, 10 s action timeout, 16 KiB text cap.
- **Dockerfile**: installs Chromium + system libraries via
  `npx playwright install --with-deps chromium`; Chromium launches with
  `--no-sandbox` (the container does not grant the sandbox privileges).

### Scope note

This is the **minimal Playwright set** the plan called for, delivered as **one
consolidated `browser` tool** rather than the 18 separate `browser_*` tools. The
rest (CDP attach, vault login, dialogs, vision) is later. Approval-free, like
`web_extract` (both fetch arbitrary URLs); navigation is bounded to http(s).

## Unit

| Area | Spec |
| --- | --- |
| Validator (per-action requirements) | `tool-registry.spec.ts` |
| Execution (navigate → service) | `tool-execution.service.spec.ts` |
| Offered-tool surface (25) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1177 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **25 tools**.

## Live

Container rebuilt with Chromium, healthy.

```
browser {action: navigate, url: "https://httpbin.org/html"} → ok
  → returned the page text: the "Herman Melville — Moby-Dick" excerpt

browser {action: screenshot} → {path: "/Users/rob/.icos/workspace/browser/1e0307c6….png"}
  → a PNG was written to the workspace (blank page: no navigation in that session)
```

Navigation loaded a real page and returned its text; `screenshot` wrote a real
PNG file. The model even used `vision_analyze` to inspect the (blank) screenshot
— the tools compose.

## Note

One tool call per step. `computer_use` remains deferred (needs an external
`cua-driver` on `$PATH`). M17d is complete.
