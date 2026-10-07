# M17b — Web tools: live evidence

> Status: **verified** (2026-10-07). Slice **M17b.3** (`web_search`,
> `web_extract`). Per-slice evidence; M17 itself is still in progress.

## What was built

- `web_search` — queries a self-hosted **SearXNG** instance's JSON API
  (`/search?q=…&format=json`); returns `{title, url, snippet}`, bounded.
  `toolset: 'web'`, `approval: 'none'`. Unavailable when `SEARXNG_BASE_URL`
  is unset.
- `web_extract` — fetches a page and returns readable text (script/style/
  comments dropped, tags stripped, entities decoded), bounded. Independent of
  SearXNG.

## Config

```
SEARXNG_BASE_URL=http://192.168.2.10:8080   # self-hosted, on the Z440
```

From the core container this is the host's **LAN address**, not `localhost`.
SearXNG must expose **JSON**: `settings.yml` → `search.formats` must include
`json`.

## Unit

Validator tests (accept/reject, bounds) in `tool-registry.spec.ts`; execution
tests with a mocked `fetch` in `tool-execution.service.spec.ts` (search result
mapping; the not-configured failure; HTML → text extraction).

Totals at capture: **1115 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean.

## Live

**Prerequisite verified.** Before enabling JSON, SearXNG answered the JSON API
with `403 Forbidden` (HTML `200`, JSON `403`). After adding `json` to
`search.formats` and restarting, `GET /search?q=…&format=json` → `200` with 20
results.

**`web_search`** — *"…search for 'SearXNG metasearch' and list the top 3 result
titles with URLs"*:

```
reply: 1. SearXNG Documentation — https://searxng.org/
       2. SearXNG instances — https://searx.space/
       3. About SearXNG — https://docs.searxng.org/user/about.html
ledger: web_search { query: "SearXNG metasearch", maxResults: 5 } → succeeded
        result { query, results: [ {title, url, snippet}, … ] }
```

**`web_extract`** — *"fetch https://httpbin.org/html and quote the heading"*:

```
reply:  The heading text on https://httpbin.org/html is: "Herman Melville - Moby-Dick"
ledger: web_extract { url: "https://httpbin.org/html" } → succeeded
        result { url, text: "Herman Melville - Moby-Dick Availing himself …", truncated: false }
```

**Failure is honest.** With JSON disabled, `web_search` returned `tool_failed`,
and a repeated identical query returned `repeated_call` (loop protection) —
the model reported the failure rather than inventing results.

## Notes / boundaries

- **Container egress:** `https://example.com` / `example.org` were
  unreachable from the container ("fetch failed") while `httpbin.org` and
  `iana.org` returned `200` — a network/DNS quirk of the container, **not** a
  tool defect. `web_extract` succeeded once pointed at a reachable host.
- **SSRF:** `web_extract` fetches arbitrary `http(s)` URLs (bounded by size and
  a 15 s timeout). Operator-controlled for now; a private-range/allow-list
  policy is a candidate hardening step.
- The bounded `MAX_EXTRACT_CHARS` (32 KB) and result-size caps apply.
