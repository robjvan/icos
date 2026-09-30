# M10f Evidence — Epistemic Invariants Verification

**Date:** 2026-09-30. **Scope:** verify every M10f invariant bullet
against committed tests + the M10e live run. No new backend code;
four additive tests closed the gaps found during the mapping pass.

## Promotion invariants

- **Every claim traces to ≥1 ledger candidate id.**
  `promotion.service.spec` `commits on approval` asserts the evidence
  array carries the promoting candidate; `createClaim` requires a
  non-empty evidence list by construction (live: all 4 claims resolve
  to ledger rows).
- **No claim without a recorded derivation.**
  New `auto-admits NEW only` asserts `listByClaimId` returns ≥1
  committed row per claim; `commits on approval` asserts the
  `NEW/committed` history entry. Journal `lists by state and traces
  claims to journal rows` covers the repository half.
- **Auto-promotion never above its risk threshold.**
  New `auto-admits NEW only`: under explicit opt-in (`fact` kinds),
  same-triple (REINFORCE) and same-pair-new-object (CONTRADICT)
  proposals park with approvals, sweep skips them (`skipped: 2`),
  and only post-approval execution commits. `keeps auto off the
  table by default` + `unknown_origin` parking cover the remaining
  matrix cells.
- **Concurrent duplicate promotions converge.**
  `converges a repeated triple to REINFORCE` (rederived intent note,
  single claim, evidence ×2) + `proposes each candidate exactly
  once` (journal idempotency key).
- **Granted approval replays to the same claim, never a duplicate.**
  `executes exactly once across repeated calls`, journal `enforces
  terminal finality with recovery replay allowed`, `replays
  interrupted rows on startup`. Restart half: new reopen tests (see
  durability).
- **Reserved fields stay null and behavior-neutral.**
  New `leaves reserved fields neutral through every M10 path` drives
  NEW + REINFORCE + CONTRADICT through one store and asserts
  `sourceType`/`summary`/`related`/`accessCount`/`lastAccessedAt`/
  `activation`/`locked`/`emotional` at defaults on every surviving
  claim; `creates claims with provenance and defaults` pins the
  baseline. (`negated` is populated by M10e and is explicitly not
  reserved — see the claim-model doc comment.)

## Provenance invariants

- **Re-mining touches `lastSurfacedAt` only.**
  `appends evidence without rewriting origin or first assertion`
  (`firstAssertedAt` + `origin` stable, `timesObserved` bumps).
- **Extractor and engine confidence never share a field.**
  `converges…` now asserts `confidence` 0.95 against an untouched
  `extractorConfidence` 0.9 after REINFORCE; the model keeps the two
  in separate columns with separate doc contracts.
- **Evidence lists reference, never embed.**
  Structural (`ClaimEvidence` = id + role); e2e claim detail resolves
  evidence rows from the ledger, `null` only if a row vanished.
- **Role on every entry; mixed never collapses; origin equals the
  first-asserted role; agent-mined stays agent.**
  New `keeps agent-mined facts agent-origin end to end` (assistant
  candidate → `origin: 'agent'`, evidence `role: 'assistant'`);
  `ignores already-attached evidence` + mixed-role append cover the
  no-collapse rule; `fails visibly on … unknown origin` proves legacy
  rows park instead of defaulting.
- **Pre-M10 candidates read `unknown`.**
  `reads pre-stamp rows as unknown, never defaulted` (+ pre-marker
  `negated` analogue).

## Durability invariants

- **Claims survive restart.** `persists claims and ledger-touch-free
  status across reopen`; live container restart kept all 4 claims.
- **Pending approvals survive restart.** New
  `keeps pending approvals across close and reopen`; new journal
  `survives close and reopen with states intact` (proposed +
  committed with detail); live restart kept 3 pending journal rows
  and the prospective item.
- **Ledger untouched by promotion.** E2e asserts candidate row count
  stable across approve+sweep cycles; promotion holds only a read
  handle on the ledger (`getCandidate`), and no claim/journal/
  prospective write targets `memory_candidates`. Live: 11 rows
  before and after restart.

## Retrieval invariants

- **Filters return exactly the matching set.**
  Status/category/origin list tests (`lists newest-first`,
  `filters by category and origin`, conflict lookup scoping).
  **Finding:** the M10 plan sketch names a `kind` filter, but the
  shipped API (per M10d evidence) filters by `category`/`origin` —
  claims store the mapped category, not the candidate kind, so a
  kind filter has nothing to read. Deliberate, not a gap; recorded
  so nobody re-adds it as a bug.
- **Contradicted claims stay queryable.**
  Status-filter tests, e2e `status=contradicted` query returning the
  loser, live restart listing both contradicted claims.
- **Prospective items list open questions.**
  E2e `contradicts a belief and parks a prospective question`
  (trigger, contest count, options with origins/confidences,
  question text); unit merge/persistence tests; live
  `repeated_contest` item with three valued options.

## Scope-boundary rechecks

- **Agent turns stay belief-free:** `conversation.service.ts` holds
  no `ClaimRepository` / `ProspectiveItemRepository` / `ClaimIndex`
  reference (grep-verified) — proposals flow out, beliefs never flow
  in. M11's single granted write (`accessCount`/`lastAccessedAt`)
  has no writer yet.
- **Ledger write discipline:** M10 paths write `claims`,
  `promotion_journal`, `prospective_items` only. The one ledger touch
  is the additive `negated` column + marker backfill (M10e), which
  writes no existing row values.
- **No context injection, no dynamics, no graph, no decay:**
  unchanged from the M10a–M10d slices; the new code adds a writer
  (promotion → prospective) and a reader (`GET /core/prospective`)
  only.

## Totals

595 unit green (39 suites), 46 e2e green, `tsc`/`eslint` clean,
live run (M10e evidence) covering contradiction → park → restart.
Definition-of-done evidence for M10 is now committed across 10a–10f.

## Addendum 2026-09-30 — live re-run vs the rebuilt drone model

After a host reinstall, the extraction model was rebuilt as
`gemma4-e4b-mem` (helpful system, 8k ctx, no sampling options).
A full live re-run against it (host-run core off a fresh build,
scratch DBs, OpenRouter chat + Ollama extraction) re-proved the
pipeline and closed the one gap in the M10e run:

- Turn 1 `favourite … TypeScript` → `(user, prefers, TypeScript)`
  affirmed → approved → `NEW`.
- Turn 2 `… Rust now, not TypeScript anymore` → the rebuilt model
  emitted the **same-triple negation** shape the M10e run never
  caught live: `(user, prefers, TypeScript)` with `neg=true` plus
  `(user, prefers, Rust)` affirmed. Proposal intents read
  `CONTRADICT`/`CONTRADICT` before execution; sweep
  `{contradicted: 2, skipped: 2}`; final beliefs: affirmed-TS
  contradicted, Rust contradicted, negated-TS active — each
  transition journaled with `contradicts:<id>`.
- The second contest tripped the repeat rule: parked
  `repeated_contest` item, `contestCount: 2`, all three options with
  user origins and claim ids. Ledger stable at 9 rows.
- **Finding for M11:** the parked question renders affirmed and
  negated rivals identically (`TypeScript vs Rust vs TypeScript`)
  — options are distinguishable only by claim id. Surfacing work
  should render the marker (e.g. `not TypeScript`); the template
  stays marker-blind in M10 by design.

Infra notes: the container path hit Docker Desktop's DMR hijack of
`host.docker.internal:11434` (container saw the raw GGUF catalog,
not the host model), so the run went host-direct; `core/.env` still
carries `MEMORY_LLM_BASE_URL=http://localhost:11434/v1`, which only
resolves in-container by accident of that same hijack — set it to
`host.docker.internal` deliberately or expect DMR answers. Also:
per-request `num_predict` returns empty output on this model build
(isolated by probe); ICOS sends no per-request sampling options, so
the live path is unaffected — but never add `max_tokens` to the
memory client without re-probing.
