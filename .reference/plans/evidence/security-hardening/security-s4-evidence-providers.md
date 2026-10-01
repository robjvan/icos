# Security S4 Evidence — LLM Provider Registry

**Date:** 2026-10-01. **Scope:** LLM providers as data (a catalog),
active selection, key references via the SecretStore, per-provider test,
health surface. Provider-agnostic rule unchanged.

## What landed

- **Catalog** (`providers/provider-catalog.ts`): `providers.json`
  (`PROVIDERS_PATH`, default `~/.icos/providers.json`) with
  `{ active: { conversation?, memory? }, providers: [...] }`; entries
  `{ id, baseUrl, model, apiKeyRef?, headers?, userAgent?, timeoutMs?,
  enabled? }`. `apiKeyRef` and header values must be references
  (`$VAR`/`secret:NAME`) — literals rejected. Invalid entries and
  unknown `active` ids are reported and skipped (one bad entry never
  blocks the rest); absent file = env-only behavior exactly.
- **Registry** (`providers/provider-registry.service.ts`): resolves the
  active conversation/memory endpoint **on demand**, falling back to the
  env `LLM_*` / `MEMORY_LLM_*` endpoints when no catalog entry is
  active. `report()` yields ids/models/base URLs/key **presence** only.
  `testConnection(id)` probes `<baseUrl>/models`, using the resolved key
  transiently. `setActive(role, id)` persists the selection to the file
  and reloads.
- **Routed clients** (`llm/llm-client.providers.ts`): `LlmClient` gained
  a protected `endpoint()` accessor; `ConversationLlmClient` /
  `MemoryLlmClient` override it to follow the registry, so a reload,
  an active switch, or a rotated key takes effect **without a restart**
  (the injected instance is never rebuilt). Env endpoint mapping moved
  here from a neutral home to avoid a cycle.
- **API** (`providers/providers.controller.ts`, admin-only):
  `GET /core/providers` (report), `POST /core/providers/reload`,
  `POST /core/providers/active {role,id}`, `POST
  /core/providers/:id/test` (404 unknown). Never returns a key.
- **Health** (`health-report.ts`): new optional `providers` section
  (`source`, `active`, per-entry `{id, model, enabled, hasKey}`),
  wired through `HealthService`; the `/health` slash command (which has
  no registry) omits it, like the MCP section.
- **Config/docs**: `PROVIDERS_PATH` (`.env.sample` documented); the
  Secrets section notes references apply to providers too.

## Verification

- **861 unit** (24 new: catalog parse/validate/duplicates/active/errors/
  load; registry env fallback, active resolution + key/header refs,
  disabled/missing fallback, `setActive` persistence, `testConnection`
  with a stubbed fetch asserting the URL + Bearer header; routed clients
  following the active provider; health providers section) **+ 57 e2e**
  (2 new: list + referenced-key presence + active switch + reload +
  bad-id 400; test-connection + unknown 404). `tsc`/`eslint` clean.
- **Live (scratch core :3104, providers.json + vault)**:
  - catalog loaded; `GET /core/providers` → `source: catalog`,
    `active` from the file, `hasKey=false` initially, **no key** in the
    response.
  - `PUT /core/secrets/openrouter` (the real key, via the write-only
    API) → `hasKey` flips **true**; `POST /core/providers/remote/test`
    → `{ok:true, detail:"HTTP 200"}` (upstream accepted the resolved
    key). The key never appeared in any response or the logs.
  - `POST /core/providers/active {conversation: local}` (no restart) →
    the **next conversation turn ran on the local model**
    (`model: gemma4-e4b-mem:latest`, correct reply) — the catalog drives
    the live LLM path.
  - `GET /core/health` includes the `providers` section, no keys.

## Notes

- Runtime switching means one endpoint is resolved per request; a switch
  mid-request is not a scenario (each `complete()` captures the endpoint
  once).
- `setActive` rewrites `providers.json` (`{active, providers}`); unknown
  fields are dropped (acceptable — the file is a managed catalog).
- A provider whose `apiKeyRef` does not resolve simply sends no key and
  the upstream rejects it visibly; key presence is surfaced in the
  report/health.
