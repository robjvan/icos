# M14g Evidence — Web-Client Persona Review

**Date:** 2026-10-03. **Scope:** the persona review surface in the web
client plus the read endpoints it needs. No new server semantics beyond
read projections.

## Backend (read-only additions)

- **`PersonaQueryService`** (`persona-query.service.ts`): `pending()`,
  `overview()` (records + user facts + relationship), `drift(limit)`.
  Thin delegates over `PersonaRepository`, scoped to the single-user
  `DEFAULT_PERSONA_USER_ID`.
- **Endpoints** (`persona.controller.ts`): `GET /core/persona/records`
  and `GET /core/persona/drift` (admin-only). `GET /core/persona/
  candidates` now reads through the query service; the duplicate
  `listPending` method was removed from the review service.

## Web client

- **Constants:** `PERSONA_ENDPOINT = '/core/persona'`.
- **Model** (`models/persona.ts`): the persona DTOs (core view, records,
  user facts, relationship, candidate, drift entry, review result).
- **Service** (`services/persona.service.ts`): signals for core, evolving
  tier, candidates, and drift; `refresh()` fetches them in parallel;
  `review(candidateId, { outcome, reason, reviewedBy })` posts and
  re-fetches. A refusal is returned as a normal result, not an error.
- **Component** (`components/identity-tab/`): the M14 placeholder is
  replaced by the real surface.
  - **Core** panel: read-only, shows the recorded sha256 (truncated) and
    each immutable entry tagged with its category — no edit affordance.
  - **Evolving** panel: identity records (category, protected chip,
    confidence, source), user facts, relationship state.
  - **Pending review** panel: each candidate shows observation, category,
    confidence, and provenance (source, session, turn, claim); an approve
    target select, a **required reason** input, and Approve / Reject /
    Archive / Needs-evidence actions. Actions are disabled until a
    reviewer name and a reason are present.
  - **History** panel: the drift/audit log, with `critical` findings
    flagged.
  - A core refusal is surfaced as `Refused — <reason>`.

## Verification

- **Core: 924 unit + 59 e2e green.** 2 new unit tests cover the query
  projections (overview; pending + drift). `tsc` / `eslint` clean.
- **Web client: 185 tests green** (6 new identity-tab tests: init load;
  read-only core render with hash; candidate provenance render; the
  reviewer+reason gate; approve to the selected target; reject;
  refusal surfaced; no action without a reason). `ng build` and `eslint`
  clean.

## Deferred

**M14h** — the isolation / tamper-evidence closing proof for the
milestone.
