# M14h Evidence — Verification (milestone close)

**Date:** 2026-10-03. **Scope:** the closing verification pass for M14
Persistent Persona Maintenance. No new product behavior; this pass adds
the isolation/tamper test and the persona e2e, and audits the invariants.

## Definition of Done (M14 plan)

> A running ICOS carries an immutable core it cannot alter, an evolving
> self/user/relationship model that changes only through reviewed
> candidates, grounding injected at session start as its own
> provenance-tagged band, and full isolation such that tampering with
> memory cannot change identity and tampering with anything cannot change
> the core — with every persona change answerable in one place.

## Verification matrix

| Invariant | Evidence | Result |
| --- | --- | --- |
| No core write path | Audit: no file-write call anywhere in `src/persona`; controller has no core mutation route | pass |
| Core cannot be altered via API | e2e: `POST`/`PUT`/`DELETE /core/persona/core` → 404; core file bytes identical after a turn | pass |
| Core change is a human act | M14b test: hash changes only when the file changes; logged `persona_core_changed` (`info`) | pass |
| Fail closed without a core | M14b addendum: `PERSONA_CORE_REQUIRED` (default true) aborts boot; dev escape hatch covered | pass |
| Identity isolated from memory | M14h isolation test: dropping memory tables leaves the persona record, core hash, and core bytes unchanged | pass |
| Separate stores | M14a test: the persona DB contains only persona tables | pass |
| Grounding | M14d tests: weak → `needsWarmup`; full → score 1; core entries first + `immutable`; truncation | pass |
| Seed import | M14c tests: idempotence, path-escape / absolute / non-.md rejection, placeholder skip, changed-seed conflict staging | pass |
| Stage only | M14e tests: extraction stages candidates, never a persona record; idempotent; reviewed not resurrected | pass |
| Review + core refusal | M14f tests: each outcome + drift log; protected overwrite via review only; core conflict refused `critical` | pass |
| End-to-end | `test/persona.e2e-spec.ts`: a live-model turn carries `<persona_grounding>` with the core; stage → review → **restart persists**; a core-contradicting approval is refused | pass |

## No-write-path audit

```
grep -rn "writeFile|appendFile|writeSync|createWriteStream|renameSync|
          unlinkSync|mkdirSync" src/persona --include=*.ts | grep -v .spec.ts
-> NONE

readFileSync in src/persona:
  src/persona/persona-core.service.ts   (core load)
  src/persona/persona-seed-import.service.ts  (seed read)

mutation routes on the persona controller:
  POST candidates/:id/review
  POST seeds/import        (no core mutation route exists)
```

The strongest deployment additionally bind-mounts the core directory
read-only, so a compromised process still cannot write it.

## Commands

- **core unit:** `npx jest` → **925 passed** (1 new isolation test).
- **core e2e:** `npm run test:e2e` → **63 passed** (4 new persona e2e).
- **core types/lint:** `npx tsc --noEmit` and
  `npx eslint "{src,test}/**/*.ts"` → clean.
- **web client:** `npm run lint`, `npx ng build`,
  `npx ng test --watch=false` → clean; **185 tests**.
- **Docker build:** `.dockerignore` fix (M13 follow-up) verified: the
  image carries no host `node_modules` / `.env`, and `better-sqlite3`
  loads on Linux.

## Conclusion

Every invariant in the M14 Definition of Done is demonstrated by
committed unit, e2e, and audit evidence. **M14 is complete.** The
immutable core is the constitution the running system cannot alter;
identity is sealed from memory; the evolving tier changes only through
recorded review; and the grounding band, staging, and curation are
visible in one place.

## Deferred (not M14)

- **M15** — structural / semantic / cumulative drift detection
  (extends `statementsContradict`).
- **M15.5** — claim/evidence consistency + secondary-model verification.
- **Core Provenance & Integrity** plan — signing/packaging, runtime
  tamper-evidence, capability-backing audit (`.reference/plans/
  core-provenance-integrity.md`).
