# FG9c — Provider & model switcher: evidence

> Status: **verified** (2026-10-17). Release-1.0 exit criteria, **FG9c**. Plan:
> `.reference/plans/fg9c-provider-model-switcher.md`.

## Design

Pick a provider and a model on the fly, from the list the provider advertises.

- **Catalog:** a per-role `activeModel` override (`{ conversation?, memory? }`),
  parsed/serialized and preserved across upsert/remove. Providers keep a default
  model; the override is the *active selection* (D1 = separate selection).
- **Registry:** `setActive(role, id, model?)` applies/clears the override;
  `conversation`/`memory` endpoints use `activeModel[role] ?? entry.model`;
  `report()` exposes `activeModel`. `listModels(id)` / `probeModels(baseUrl,
  apiKeyRef?)` fetch `/models` (ids + `context_length`).
- **Routes:** `GET /core/providers/:id/models`, `POST /core/providers/models`
  (ad-hoc, for the editor), `POST /core/providers/active { role, id, model? }`
  — all admin-only.
- **Models tab:** an *Active selection* panel (provider → load models → model →
  Apply) and a "Load models" datalist in the editor.
- **Key UX:** a pasted literal key is stored in the encrypted vault (as
  `<id>-key`) and referenced — the catalog still holds references only. The
  API-key/Headers/User-agent fields now explain themselves.
- **`/model` command (S4):** deterministic, no LLM contact — `/model` (status),
  `/model <model>` (model on the active provider; model ids may contain
  slashes), `/model <provider> <model>`, `/model <provider>`,
  `/model list [provider]`.

## Unit

Core **1288 passing** (2 pre-existing `persona-drift-corpus` failures,
unrelated). Web **208 passing**. `tsc`/`eslint` clean.

New coverage: `provider-catalog.spec` (`contextWindow`, `activeModel` parse +
round-trip), `provider-registry.service.spec` (active-model override applied to
the endpoint, `activeEntry`, `onChange`, `listModels`), `models-tab.spec`
(active selection + vault-on-paste).

## E2E

Core e2e **74 passing**.

## Live run

Booted the real core (temp data dir, `AUTH_ENABLED=false`, a temp vault) and
exercised the whole path:

```
PUT /core/secrets/openrouter-key   -> 200   (key vaulted)
PUT /core/providers/openrouter     -> 200   (references secret:openrouter-key)
PUT literal apiKeyRef              -> 400   (with guidance to the Models tab)
POST /core/providers/active        -> 200
REPORT: [{ "id":"openrouter", "hasKey":true, "contextWindow":131072 }]
```

Provider switching (and the window re-resolve) was verified separately in the
FG6 live run (`setActive` → endpoint model + window both follow).

`/model` (S4) live run:

```
$ /model
Conversation: ollama · (env)
Providers (catalog): local
$ /model local gemma4:e4b
Conversation model → local · gemma4:e4b. Takes effect on the next turn.
$ /model
Conversation: local · gemma4:e4b
$ /model list local
Models for local (2):
- stub-16k (16384 tokens)
- gemma4:e4b (16384 tokens)
```

## Verdict

**Pass** — the operator configures multiple providers, lists each one's models,
and selects a (provider, model) per role from the Models tab **and** via
`/model`; it takes effect without a restart.

## Remainder

- Capability badges (per-model metadata beyond the window) stay deferred.
- `/model` targets the **conversation** role; memory is set via the Models tab.
