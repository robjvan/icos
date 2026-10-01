# M13f Live Evidence — ByteStash over Streamable HTTP (PARTIAL)

**Date:** 2026-10-01. **Status:** partial — HTTP live leg done
against the operator's ByteStash (`https://snippets.exilelogic.ca/mcp`,
Bearer auth). Still pending for full M13f: live stdio server leg,
live timeout/drop/reconnect, live malformed-server behavior.
Unit/fake coverage for those stands; this file records only what
ran against the real server. **No secrets in this file** (token
traveled via `BYTESTASH_AUTH` env only) and none in the repo.

## Transport matrix (live, HTTP)

- **Connect + discover**: `connected`, 6 tools
  (`list_snippets`, `get_snippet`, `create_snippet`,
  `update_snippet`, `delete_snippet`, `list_metadata`).
- **Call** (read-only): `list_metadata {}` → categories JSON,
  `isError: false`; `list_snippets {"limit": 2}` → snippets
  incl. id 7, `isError: false`; `get_snippet {"id": 7}` →
  "Geolocation by IP", `isError: false`. No writes were
  attempted live (`delete_snippet` was never called).
- **Failure isolation (live)**: the LAN URL
  (`http://192.168.2.10:5000/mcp`, unreachable from this host)
  failed soft — `failed: fetch failed`, empty bridge, nothing
  bricked. Same shape as the unit fail-soft matrix.

## Bridging honesty (live findings)

- First probe hid `create_snippet` + `update_snippet`
  ("schema outside subset"). Their schemas are legitimate
  closed shapes — the translator's blanket
  `additionalProperties` ban rejected the nested
  `additionalProperties: false` markers. Fixed: the ban now
  applies only when the value would widen (`true` or a
  schema); `false` is accepted (it matches the emitted closed
  shape). Re-probe: **6/6 bridged**, all `approval=required`.
  Unit regression added (nested closed objects accept,
  truthy/schema forms still refuse).
- Scalar bounds the translator does not enforce
  (`minimum`/`maximum`/`minLength`/`minItems`, present on
  `list_snippets`) are ignored by validation — the server
  remains the authority and its refusals surface as honest
  `mcp_failed`. Documented widening, not silent: structural
  unboundedness still hides the tool.

## Approval gating (live end-to-end turn)

Scratch core (`:3100`, scratch DBs, `MCP_ENABLED=true`,
catalog with `"Authorization": "$BYTESTASH_AUTH"`),
model `deepseek/deepseek-v4-flash-0731` via OpenRouter:

1. `POST /core/conversation` —
   "What snippet categories exist in my ByteStash? Use the
   bytestash tools to look them up."
   → `approval_required`, tool `mcp_bytestash_list_metadata`,
   minted `mcp.execute` approval. The model proposed the
   foreign tool unprompted beyond the goal text.
2. `POST /core/approvals/:id/approve` → `approved`.
3. `POST /core/conversation/resume` → `ok`, reply grounded
   in live data (22 categories across 23 snippets, incl.
   angular/api/auth/backend/coolify… plus observed languages).
   Ledger: tool row `succeeded`, approval bound,
   `execution = {ok, mcp: {server: bytestash,
   tool: list_metadata}}`; continuation text row `closed`.
   `grep` of the core log: token absent.

## Auth surface (shipped for this leg)

- Catalog `headers` (http-only; stdio+headers and literals
  rejected at validation, mirroring `env`): values are
  `$VAR` references resolved at transport build, missing
  vars fail closed naming the variable only. Unit-tested.
  `.env.sample` documents the `BYTESTASH_AUTH="Bearer …"`
  contract (name only, never a value).
