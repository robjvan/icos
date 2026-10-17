# FG9c — Provider & model switcher

> Status: **planned** (2026-10-17). Source: release-1.0 exit criteria, **FG9c**
> (`.reference/notes/release-1.0-exit-criteria.md`). Extends the original
> "model auto-detect" item with on-the-fly provider + model switching.

## Problem

A user configures providers in the Models tab (add/edit/remove; pick the active
provider per role) but must **type the model name by hand**, and there is no
quick way to change the model while chatting. The provider's `/models` endpoint
already lists what it offers — we just don't use it.

## Goal

Pick a **provider and a model on the fly**, from a list the provider advertises,
and have it take effect immediately for the conversation role (and memory). No
typing model names; no restart.

## What already exists (the reassuring part)

- **Multiple providers** in `providers.json` — add/edit/remove, active per role
  (Models tab, S5). *This half is already built.*
- **Key references through the vault** (`apiKeyRef` = `secret:NAME`) — done.
- **Active provider switch** (`POST /core/providers/active`) — takes effect on
  the next turn (the registry resolves on demand, no restart).
- **`testConnection()`** already fetches `<baseUrl>/models`.
- **FG6** re-resolves the context window on a provider change.

So "configure multiple providers" is not new work — only model listing and the
switcher UX are.

## What's missing

1. **Model listing** — `GET /core/providers/:id/models`, reusing the `/models`
   fetch; return model ids (+ `context_length` where advertised, to auto-fill
   the FG6 window).
2. **Model selection in the Models tab** — the Model field becomes a type-ahead
   / dropdown populated from (1).
3. **A quick switcher** — change (provider, model) while chatting.

## Design decisions (open — need a call)

### D1 — What does "pick a model" change?

- **(a) Edit the provider entry's model.** Picking a model for provider X
  updates X's `model` (reuse `PUT /core/providers/:id`). Simple; the choice
  persists as config. But it reads as "editing config", not "switching".
- **(b) A separate active selection.** The catalog keeps a per-role active
  `{ provider, model }`; each provider entry keeps a default model. Cleaner
  "I'm switching the chat model" semantics, and switching models doesn't rewrite
  a provider's configured default. Costs a catalog field + a resolution change.

### D2 — Where does the switcher live?

- **(a) Chat header / composer** — a compact "provider · model" control; the
  QoL win.
- **(b) Models tab only** — pick each provider's model there; switch the active
  provider there.
- **(c) Both** — pick in the tab, quick-switch while chatting.

## Slices

- **S1** — backend `listModels` + route + tests.
- **S2** — Models-tab model dropdown (per provider).
- **S3** — the quick switcher (per D2).
- **S4** — evidence: unit + e2e + a live run against a provider exposing several
  models, switching provider and model without a restart.

## Exit criteria (FG9c)

- The operator picks a provider's model from a list and swaps provider + model
  on the fly; it takes effect without a restart.
- Proof: live run against a provider exposing several models, selecting one, and
  seeing it become the active model.
