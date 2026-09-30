# Web Client — Phase 5: Contradiction Transparency (`web-client/`)

Status: **plan only — no code touched.**
Scope: `web-client/` only. No core changes (the pairing data already
exists server-side; UI reads it). Follows the same verification bar
as Phase 4 (`tsc` + `eslint` clean, `ng test` green, AXE clean,
evidence committed, commits on `dev`, no push).
Branch: `dev`.

## 1. Goal

Contradicted claims currently render as flags with no visible
counterpart — the loser names no winner (live-use report 2026-09-30:
two facts flagged `contradicted` with no visible affecting fact).
Make every contradiction legible in both directions, and hang the
parked clarification question off the same pair when one exists.

## 2. What the server already gives (no new endpoints)

- Journal `CONTRADICT committed contradicts:<loserId>` rows with
  `claimId` = winner (`GET /core/promotions`, `listByClaimId`).
- `GET /core/claims/:winnerId` history carries the same row.
- `GET /core/prospective` options carry both sides (`object` +
  `origin` + `confidence` + `claimId`).
- The loser→winner direction needs a journal scan today; the client
  already parses `contradicts:<id>` notes (`models/promotion.ts`
  `contradictsClaimId()`) — reuse that, don't invent a protocol.

Out of scope: populating reserved `related[]` at contradict time
(backend pairing substrate — M11c owns that decision, not this
phase); any surfacing beyond inspection (no agent questions, no
nudges — M10e's "parked, never nags" rule holds).

## 3. Work items

1. **Loser row:** render "contradicted by \<winner object\>" with a
   claim link (Beliefs `claim-list/` detail + row cue, icon + label
   per D7 — never colour-only).
2. **Winner row:** render the reverse link ("contradicts \<loser
   object\>") so the pair reads in both directions.
3. **Fourth segment seam (from Phase 4 §9.1):** when a prospective
   item exists for the pair, link it from both rows; reserve (don't
   build) a dedicated prospective segment.
4. **Negation rendering:** affirmed vs negated rivals share triple
   text — the pair must show the marker (e.g. `not TypeScript`),
   never two identical values (live finding, M10f evidence addendum).
5. Specs for the pairing derivation (both directions, missing-row
   tolerance, negation labels) + AXE pass on the touched views.

## 4. Verification

Mirror Phase 4 §2–§5 at this slice's scale: unit specs for the new
derivation/display, `ng test` green, AXE clean on Beliefs (dark +
light), one live-core pass showing a contradicted pair linked both
ways, evidence file
`.reference/plans/evidence/web-client-phase5-contradiction-transparency.md`.
