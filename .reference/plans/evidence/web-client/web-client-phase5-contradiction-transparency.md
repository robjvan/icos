# Web Client — Phase 5 Evidence (Contradiction Transparency)

Date: 2026-09-30. Branch: `dev`. Scope: `web-client/` only — no
core changes (pairing data already existed server-side). Committed
on `dev`, no push.

## What landed

- **Pairing derivation** (`models/contradiction.ts`, pure + specced):
  committed `CONTRADICT` journal rows pair winner (`claimId`) to
  loser (`contradicts:<id>`); `pairFor` resolves both directions;
  `prospectiveFor` matches open items by option claim id;
  missing counterparts render by short id, never crash.
- **Beliefs rows** (`claim-list/`): contradicted rows cue
  "contradicted by \<object\>", winner rows "contradicts
  \<object\>", each a link opening the counterpart (sibling
  button — never nested, AXE-safe). Open-question cue when a
  parked item touches the pair.
- **Detail**: Contradiction section with directional link +
  parked question text (`Open question:` + suggested phrasing).
- **Negation markers** on row, search-result, and detail
  statements (`not "X"`), via tested `claimObjectLabel` /
  `claimStatement` helpers. Client `Claim` mirror gained the M10e
  `negated` field (was stale).
- **New client surface**: `PROSPECTIVE_ENDPOINT` + `ClaimService`
  `listCommittedContradictions()` / `listProspective()`; pairing
  fetches are best-effort (failed journal/prospective leaves
  unpaired rows, never a failed Beliefs view).
- Out of scope kept out: no `related[]` writes, no surfacing
  beyond inspection, no realtime mirror changes (unknown event
  types fall through the client switch harmlessly).

## Verification

- **Unit: 44 files / 168 tests green** (new: pairing both
  directions + noteless/non-committed filtering, prospective
  match + dismissed skip, negation labels, row cues + link,
  detail pair + question, pairing-failure degradation).
- **`tsc` + `eslint` clean.**
- **Browser (Chromium via playwright-core, `ng serve` + live
  scratch core):** Beliefs list dark + light — contradicted-by
  cue, `not "gouda"` marker, open-question cue all present,
  **AXE 0 violations** both themes; contradicted detail —
  `Contradicted by` + question text, **AXE 0 violations**.
- **Live leg:** real turns (cheese opinions) → live extraction
  emitted an affirmed rival *and* a `neg=true` denial →
  approved → sweep `{contradicted: 2}` → journal
  `CONTRADICT/committed contradicts:<id>` rows, `repeated_contest`
  prospective item, negated claim active — the exact endpoints the
  client reads, verified before the browser pass.

## Notable findings

- **Chains show one direction per row.** A mid-chain claim (both
  winner and loser, e.g. cheddar here) renders its first journal
  pair only. Correct per-row, incomplete per-chain — chain
  traversal is M12-revision territory, recorded here so Phase 5
  isn't credited with solving it.
- **Probe bug, not app bug:** the first detail probe matched
  "contradicts" rows against a "Contradicted by" expectation.
  Fixed by targeting loser rows; the app behaved throughout.
