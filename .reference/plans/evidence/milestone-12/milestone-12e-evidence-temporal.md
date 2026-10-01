# M12e Evidence — Temporal Reasoning

**Date:** 2026-10-01. **Scope:** timeline query axis, time-anchored
revision links, temporal adjacency data. No new write paths for
temporal data itself; no dedicated time-perception source (per the
dependency note — works on stored timestamps only).

## What landed

- **Timeline index.** `ClaimRepository.listClaimsByTime`
  ({from, to, sessionId, limit}) + `GET /core/claims/timeline`
  (registered before `:id`, like `search`). Window over
  `created_at` (ISO lexicographic, newest first); conversation
  scope resolves through ledger references (evidence candidate
  ids → sessions via JSON1, read-only). Claims store no session
  of their own — the join is the honest shape of the data.
- **Time-anchored cross-links.** Revision now gathers evidence
  sessions from both parties, finds session-mate claims (bounded
  scan, capped at 5, pair excluded), and links them one-way from
  the winner — covered by the winner's `revise` history row
  (`anchoredSessions` + `anchoredClaims`). "I remember this
  because it was the X conversation" stays walkable through
  `related[]` + history, with no new columns.
- **Temporal adjacency weights.** Pure `temporalProximity`
  (1 co-temporal → week-scale decay, symmetric, NaN-proof) owned
  as data for future rank integration. Rank does not consume it
  yet — deliberately: M11f is closed, and an unconsumed pure
  function with tests beats a wired-in weight with no caller.
  Flagged for the next ranking touch, whenever that lands.
- **History migration.** `classify` + `activate` transitions added
  to the `claim_history` CHECK via table rebuild (rows preserved,
  idempotent guard requires both values).

## Verification

- **698 unit green**: window/session/limit timeline queries
  (incl. backdated rows + ledger-scoped sessions), proximity
  curve, anchored winner links + history detail, CHECK migration
  preserving rows while admitting new transitions.
- **48 e2e green**, incl. timeline (window hit/miss, session
  scope hit/miss) off a real promoted claim.
- **`tsc`/`eslint` clean.**

## Notable findings

- **JSON1 subqueries work in better-sqlite3's bundled SQLite**
  (evidence-id unpacking for session scope) — pinned by test,
  not assumed.
- **One-way anchor links are sufficient.** The winner points at
  session mates; mates don't point back. The use case is
  directional (from the revised belief to its context), and
  bidirectional writes would double history spam for no
  traversal gain (multi-hop is out of scope anyway).
