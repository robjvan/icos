# M14c Evidence — Seed Import (Evolving Baseline)

**Date:** 2026-10-02. **Scope:** guarded Markdown seed import into the
**evolving** persona tier. No grounding (M14d), no review application
(M14f), no UI (M14g). The immutable core (M14b) is never a seed target.

## What landed

- **Parser** (`persona-seed.ts`): a port of the v2 coherence-engine seed
  importer. Section headings map to `PersonaCategory` + sensitivity +
  `protected` + layer via `seedSectionPolicy`; bullets/paragraphs become
  keyed candidates (`ordinal:slug:index`, stable per source file).
  Unrecognized `persona` headings fall back to `self` (v2 behavior);
  `soul` files are stricter.
- **Importer** (`persona-seed-import.service.ts`): reads each source,
  parses, and applies candidates through the persona repository:
  - **guarded root** (`PERSONA_SEED_ROOT`, default `~/.icos/seeds`):
    relative paths only, `.md` only, `realpath` containment, ≤20 files;
  - **idempotent** by content hash — an unchanged seed writes nothing;
  - **template placeholders skipped**, never persisted;
  - a changed seed updates only its own untouched `seeded` baseline
    (`metadata.seeded === true` ∧ same source ∧ `seedContentHash` matches
    the current content); anything else is **staged as a candidate**
    (with `seedUpdate`, `targetRecordId`, `previousContent`, and
    `conflictsWithProtectedAnchor`), never an overwrite;
  - `dryRun` writes nothing.
- **API** (`persona.controller.ts`): `POST /core/persona/seeds/import`
  (admin-only, CSRF-gated by the global guard) with
  `PersonaSeedImportDto` bounding the top-level shape; the service
  validates each source.
- **DRY pass:** the Markdown helpers shared by the core parser and the
  seed parser moved to `persona-markdown.ts`, and the deterministic id to
  `persona-ids.ts`; `persona-core.ts` and `sqlite-persona.repository.ts`
  now import them (no behavior change — their suites stay green).
- **Config / env:** `PERSONA_SEED_ROOT` documented in `.env.sample`.

## The core is never a seed target

The importer depends only on `PersonaRepository` (records + candidates).
It has no reference to `PersonaCoreService` or the core file, so a seed
can only ever write `persona_records` / `persona_candidates`. The
isolation is structural, not a runtime check.

## Verification

- **900 unit green** (12 new): parser — heading→policy mapping, persona
  self fallback vs soul strictness, signature-moments skip, keyed
  candidates; importer — create + tier fields, idempotence, dry run,
  changed-seed updates the untouched baseline only, curated record →
  conflict staged (candidate, core untouched), placeholder skip, path
  escape / absolute path / non-Markdown rejection, missing seed root.
- **59 e2e green** (module boots with the new provider + route).
- **`tsc` clean.**
- **`eslint` clean** across `{src,test}/**/*.ts`.

## Deferred

Portable JSON package import (recorded, not built). Applying a staged
seed conflict to a record is review (M14f). Wiring extraction → staging
is M14e. Grounding + the prompt band is M14d.
