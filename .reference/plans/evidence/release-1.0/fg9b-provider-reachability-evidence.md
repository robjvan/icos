# FG9b — Provider reachability / health visibility: evidence

> Status: **verified** (2026-10-17). Release-1.0 exit criteria, **FG9b**.

## Design

The health report used to read `runtime.llm = unknown — reachability not
probed`, so a misconfigured endpoint (`host.docker.internal` from the wrong
network) failed silently. Now the active endpoint is probed:

- `ProviderRegistryService.reachability(role)` / `providerReachability(id)`
  probe `<baseUrl>/models` (3s timeout), cached 30s. **Reachability = the
  endpoint answered at all** — a 404 on `/models` is common (opencode) and is
  *not* a failure; a network error/timeout is unreachable; a 5xx is degraded.
- `buildHealthReport` folds the conversation probe into `runtime.llm`
  (`status`, `reachable`, detail) and adds `providers.reachability`
  (`conversation` + `memory`) plus a per-provider `reachable` flag.
- `PROVIDER_REACHABILITY_ENABLED` (default true) disables the probe — health
  stays config-only (used by the e2e for determinism).
- Web: the footer shows an **LLM ok/down** chip (and no longer reads the core
  as "Offline" just because the LLM is down — that is now "Degraded"); the
  Models tab shows a per-provider up/down badge and the active reachability.

## Unit

Core **1299 passing** (2 pre-existing `persona-drift-corpus` failures,
unrelated). Web **208 passing**. `tsc`/`eslint` clean.

New coverage: registry reachability (404 = reachable, network error =
unreachable, 5xx = degraded, cached), and the health report folding it into
`runtime.llm` + `providers.reachability` (+ `degraded` roll-up).

## E2E

Core e2e **75 passing** (the health e2e pins `PROVIDER_REACHABILITY_ENABLED=false`
so it never depends on a local daemon).

## Live run

Booted the real core against a dead endpoint and against real Ollama:

```
=== DEAD endpoint (LLM_BASE_URL=http://127.0.0.1:1/v1) ===
status: degraded
runtime.llm: {"status":"degraded","detail":"ollama/m: unreachable (connection failed)","reachable":false}
providers.reachability.conversation: {"ok":false,"detail":"unreachable (connection failed)"}
providers.reachability.memory:       {"ok":true,"detail":"reachable (HTTP 200)"}

=== REAL Ollama (LLM_BASE_URL=http://localhost:11434/v1) ===
status: healthy
runtime.llm: {"status":"healthy","detail":"ollama/m: reachable (HTTP 200)","reachable":true}
```

A dead provider now fails **visibly** (`degraded` + `reachable:false`), the two
roles are probed independently, and a live endpoint reads `reachable`.

## Verdict

**Pass** — a configured provider's reachability is surfaced (health report,
footer chip, Models-tab badges) and a misconfiguration shows as `degraded`
instead of silently reading `unknown`.

## Remainder

- Reachability, not a full health check — a provider that answers but is broken
  beyond a 5xx still reads reachable.
- Capability badges (per-model metadata) stay deferred with FG9.
