# M11c Evidence — Cross-Memory Comparison

**Date:** 2026-09-30. **Scope:** inline conflict labeling over
ranked recall. Pure function, no repository, no traversal, no
writes — recall recommends, later slices decide.

## What landed

- **`compareRecalled(ranked)`** (`memory/comparison.ts`): groups
  recalled rows by normalized subject+predicate; distinct objects —
  or same text with opposite negation markers — yield a `conflict`
  note with every party's object, origin, confidence, marker, and
  status; a lone recalled contradiction yields a `contradicted`
  note. Familiar near-misses stay out (comparison speaks only for
  recalled rows). Parties read strongest-first (ranked order is
  fused-descending, grouping preserves it).
- **Proposals, not parking.** All-active rival groups also yield a
  `ProposedQuestion` (options + template phrasing) for M11d to
  dedupe against open prospective items. Contradicted-involved
  groups note without proposing — history recorded those, and
  re-proposing every confident first contest would unwind M10e's
  trigger policy.
- **Shared phrasing.** The M10e question template + claim-option
  builder moved to `prospective-item.ts`
  (`suggestProspectiveQuestion`, `prospectiveOptionFromClaim`);
  promotion and comparison ask identically. Promotion behavior
  unchanged (its suite pins every trigger verbatim).
- **Reserved refs honored.** `relatedIds` pass through unwalked —
  the M11 "read where populated, never traverse" rule, with a test
  proving no resolution is attempted.

## Verification

- **633 unit green** (45 suites), incl. 6 new comparison tests:
  active-pair note + origins + proposal, contradicted-pair note
  without proposal, lone-contradiction note, silence on agreement
  and familiar-only input, same-text opposite-marker conflict with
  visible flags, related passthrough.
- **46 e2e green**, **`tsc`/`eslint` clean.**
