# M14a Evidence — Persona Model + Stores

**Date:** 2026-10-02. **Scope:** the persona store — schema, database
service, repository, and wiring. No immutable core (M14b), no seed
import (M14c), no grounding band (M14d), no extraction→staging wiring
(M14e), no review application (M14f), no UI (M14g).

## What landed

- **Separate database file.** `persona.db` is its own SQLite file
  (`PERSONA_DB_PATH`, default `~/.icos/data/persona.db`), opened through
  the shared `DatabaseService` / `openDatabase` with a new `'persona'`
  schema. Identity is isolated from memory at the **filesystem** level,
  not just the table level — the M14 isolation invariant starts here.
- **Schema** (`src/session/database.ts`, `PERSONA_SCHEMA_SQL`):
  `persona_records` (category self/value/belief/boundary/commitment/
  agentic_character/relationship/other; confidence; sensitivity;
  `is_protected`), `persona_user_model`, `persona_relationship`
  (singleton per user), `persona_candidates` (with reserved review
  columns), `persona_drift_log` (severity including `cumulative`).
  Provenance columns (`source`, `source_turn_id`, `claim_id`,
  `reviewed_by`, `metadata_json`) on every row. `claim_id` is a plain
  cross-database provenance column, never a foreign key (same
  convention as the memory ledger).
- **Types** (`persona.types.ts`): the record / candidate / drift shapes
  and their input contracts, plus `DEFAULT_PERSONA_USER_ID` (the
  single-user seam).
- **Repository** (`persona.repository.ts` abstract +
  `sqlite-persona.repository.ts`): create/get/list records; upsert/
  get/list user facts; singleton relationship upsert; stage/get/list
  pending candidates; append/list drift entries; `ping`. Deterministic
  sha256-prefixed ids make staging and (later) seed import idempotent.
  The `protected` overwrite guard lives at the store: changing a
  protected record's content without a `reviewedBy` throws.
- **Wiring** (`persona-database.service.ts`, `persona.module.ts`,
  `core.module.ts`): a self-contained `PersonaModule` owns the database
  service + repository and is imported by `CoreModule`. `personaDbPath`
  is optional on `CoreConfig` (populated by `loadConfig`; fallback is a
  sibling of the memory DB) so the 30 existing test configs need no
  change.
- **Config / env:** `PERSONA_DB_PATH` documented in `.env.sample`.

## Design decisions

- **Separate file over a same-file namespace.** The plan originally said
  "same SQLite file"; the stronger requirement (memory-store tampering
  must not reach identity) is met best by a separate file, and the repo
  already splits databases by concern (`sessions`, `memories`). Plan
  text updated to match.
- **better-sqlite3**, matching the rest of core (the plan's `node:sqlite`
  note was wrong).
- **Preserve unspecified fields on re-upsert** (records, relationship,
  candidates): a repeated staging/import must never erase provenance
  already attached. A test caught the initial candidate-wipe bug.
- **Reserved review columns** on `persona_candidates` so M14f needs no
  migration.

## Verification

- **876 unit green** (10 new persona tests; every other suite
  unchanged): create/read/list + deterministic-id idempotence;
  protected overwrite refused without a reviewer and allowed with one
  (flag preserved); user-fact upsert/list idempotence; relationship
  singleton + clamping + partial-update preservation; candidate staging
  + provenance preservation; drift append/list; persistence across
  close/reopen; `ping`; **the persona file contains only persona tables
  (no `claims` / `memory_candidates` / `messages`)**; config fallback
  path.
- **`tsc` clean.**
- **`eslint` clean** across `{src,test}/**/*.ts`.

## Deferred

Immutable core file + integrity (M14b), seed import (M14c), grounding
band + context injection (M14d), extraction→staging wiring (M14e),
review application + core-conflict refusal (M14f), review UI (M14g),
and the full isolation / tamper proof (M14h).
