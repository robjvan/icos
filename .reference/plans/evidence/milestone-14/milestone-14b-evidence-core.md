# M14b Evidence — Immutable Core Persona

**Date:** 2026-10-02. **Scope:** the immutable core: file-backed parser,
read-only loader, hash-based change detection, degraded boot, and a
read-only API. No seed import (M14c), no grounding band (M14d), no
core-conflict enforcement (M14f).

## What landed

- **Parser** (`persona-core.ts`): a pure Markdown parser. Section
  headings map to the five core categories (`ethical_grounding`,
  `core_belief`, `safety_boundary`, `non_negotiable`,
  `agentic_character`); bullets and paragraphs become entries; template
  placeholders are skipped; recognized-but-empty sections warn. Ids are
  content-addressed (`category + statement`), so reordering sections
  does not change them.
- **Loader** (`persona-core.service.ts`): reads `PERSONA_CORE_PATH`
  (default `~/.icos/persona/core.md`) at boot, computes a sha256 over
  the raw bytes, parses, and exposes an immutable snapshot
  (`getEntries` / `getStatus` / `isLoaded`). `reload()` re-reads.
- **Change detection** (`persona_core_state`, a single row): records the
  path, hash, entry count, loaded flag, and reason across boots. A hash
  change is logged as `persona_core_changed` at severity **`info`** —
  an audited human edit, explicitly not a drift finding. Loss of a
  previously loaded core is logged once as `persona_core_unavailable`
  (`warning`). First-boot absence is not an audit event.
- **Degraded boot**: a missing or invalid core yields `loaded: false`
  with a reason and a loud `Logger.error`; entries are empty. Identity
  is never fabricated.
- **Read-only API** (`persona.controller.ts`):
  `GET /core/persona/core`, admin-only, returning status + entries.
  There is no mutation route.
- **Config / ops**: `PERSONA_CORE_PATH` documented in `.env.sample`
  with read-only-mount guidance; template shipped at
  `core/persona/core.example.md`.
- **Wiring**: `PersonaModule` gains `PersonaCoreService` (ordered after
  the database service) and the controller; `CoreModule` already
  imports `PersonaModule`.

## No-write-path audit

```
grep -rn "writeFile|appendFile|writeSync|appendFileSync|createWriteStream|
          renameSync|unlinkSync|mkdirSync" src/persona --include=*.ts
          | grep -v .spec.ts
-> NONE
```

The core service references `persona_core_*` only as audit `changeType`
strings; it reaches the database solely through
`repository.getCoreState` / `saveCoreState` / `logDrift`. The only
`readFileSync` in the subsystem is the core load itself. The strongest
deployment additionally bind-mounts the core directory read-only so a
compromised process still cannot write it.

## Verification

- **885 unit green** (9 new): parser — category mapping, bullet/
  paragraph extraction, unrecognized sections ignored, stable ids
  across section order, placeholder skipping, empty-section warnings;
  loader — valid load + hash + entries, missing-file degraded status
  with no first-boot audit, invalid (no recognized entries) degraded,
  human edit audited once at `info` and not re-audited when unchanged,
  loss of a loaded core flagged `warning`.
- **59 e2e green** (module boots with the new provider + controller;
  the degraded-core log is expected in the test environment).
- **`tsc` clean.**
- **`eslint` clean** across `{src,test}/**/*.ts`.

## Notes / deferred

- Grounding-score capping on a degraded core, and injecting core
  entries first in the grounding band, land in **M14d**.
- Testing a candidate against core entries for a `critical`,
  non-applicable conflict lands in **M14f**; M14b only guarantees stable
  entry ids + content to test against.
- The container read-only bind for the core directory is an M14h/ops
  concern; the code-side guarantee (no write path) holds regardless.
