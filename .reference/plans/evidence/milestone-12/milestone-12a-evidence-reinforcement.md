# M12a Evidence — Reinforcement

**Date:** 2026-09-30. **Scope:** maintenance pass infrastructure,
bounded compounding, contradiction cross-links, gist-family
detection. No decay (M12b), no revision (M12c), no belief creation.

## What landed

- **Pass infrastructure.** `MaintenanceService`: scheduled
  interval (cadence + kill-switch in config, default on/hourly,
  `unref`d, destroyed cleanly) + explicit
  `POST /core/maintenance/run`. Per-record isolation — one
  record, one transition, one history row; a throwing record is
  counted `failed`, never aborts the pass. Bounded scan (500).
- **`claim_history` audit table** (append-only; transitions
  compound/decay/revise/retire/link/gist_proposed/lock/unlock/
  suppress). Aging levels re-derive from these rows — no per-claim
  aging columns, so a crash replays instead of half-applying.
  Surfaced read-only via the claim detail response (`maintenance`
  array alongside journal `history` — additive, nothing removed).
- **Bounded compounding** (`+0.02 × min(5, timesObserved)`,
  ceiling 0.99, hard max 1 — open constants, M10-style). Applies
  only to corroboration levels without a matching `compound`
  history row: re-passes converge, never ratchet. Below-ceiling
  only; single observations never move.
- **Cross-links.** Committed journal `contradicts:<id>` rows link
  both claims' `related[]` (deduped, never self-linked) with a
  `link` history row — the traversal substrate M11 was promised,
  populated here, read there, never walked here. Idempotent.
- **Gist detection (proposal only).** N≥3 same subject+predicate
  claims with pairwise-distinct evidence propose once per family:
  a `gist_proposed` history row per member (sibling ids +
  `subject predicate *` suggestion). Shared-evidence groups never
  propose (shared derivation, not episodes). Generalization
  itself needs promotion-authority design — M12a writes no
  beliefs, only the observation that a family exists.
- **Repository additions** (M12-owned writes):
  `adjustConfidence` (estimate only, lifecycle/provenance
  untouched), `addRelated` (deduped, self-link refused).

## Verification

- **667 unit green** (49 suites): compounding math + once-only
  convergence + ceiling + single-observation silence, bilateral
  linking + idempotence, family proposal + shared-evidence
  refusal + no-reproposal, per-record failure isolation,
  schedule on/off lifecycle, history CRUD + latest-resolution,
  confidence/related isolation.
- **48 e2e green**, incl. explicit run (empty-store zeros +
  durationMs; promoted belief skips cleanly; detail carries both
  histories).
- **`tsc` / `eslint` clean.**

## Notable findings

- **A test caught a real counting bug.** `summary[outcome] += 1`
  silently wrote `NaN` under a `gist_proposed` key (snake outcome
  vs camel summary — `JSON.stringify(NaN)` even hid it as
  `null`). Fixed with an explicit mapping + comment. The lesson
  is recorded at the call site: no clever indexing on mismatched
  vocabularies.
- **Anti-decay placement.** The plan lists anti-decay-on-access
  under M12a, but the shield is meaningless without decay to
  resist — it lands in M12b as the consumer, pinned by a
  recent-access-slows-decay test. Stated here so the mapping
  stays honest.
- **Gist creation deferred deliberately.** Detection writes
  history rows only; minting a generalized claim outside M10
  promotion would violate the scope boundary ("no new claim
  creation paths"). The authority design is M12c-or-later work.
