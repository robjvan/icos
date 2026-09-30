# M11b Evidence — Ranking

**Date:** 2026-09-30. **Scope:** relevance-first ranking with honesty
gates over M11a surface hits. Reads claims + ledger timestamps,
mutates nothing (the M11 `accessCount` write stays M11d's).

## What landed

- **Fusion (RRF-60).** Order-only combiner across surfaces —
  BM25 ranks, vector distances, and resonance counts share no
  scale, so scores never mix. One claim on three surfaces is one
  row with three witnesses (dedupe by id first); near-duplicate
  suppression second (same triple + marker across ids — impossible
  through the repository, kept as a hand-built-row safety net).
- **Confidence gate.** `MEMORY_RECALL_CONFIDENCE_GATE` (default
  0.3, `.env.sample` + `parseScore`): below-gate claims exclude
  unless `includeGated` (explicit-query override, M11d's to set)
  or `locked` (M12's certainty lock always admits). Every gate
  decision lands in the trace with its reason.
- **Contradicted: demoted, labeled, kept.** Half fused weight
  (`CONTRADICTED_DEMOTE = 0.5`, open constant), `demoted: true`
  on the row, trace lists them. Never dropped, never promoted.
- **Recency gradient (true curve).** `1 / (1 + ageDays / 30)` —
  no buckets. **Deviation from plan text, recorded:** the plan
  names `lastSurfacedAt`, but the field holds a ledger *reference*,
  not a timestamp. The faithful reading resolves it to the
  candidate's `extractedAt` (read-only ledger join); a
  ledger-missed reference falls back to the claim's `updatedAt`,
  traced in `recencyFallback`.
- **Provenance lens.** Per-call `{ exclude, downweight }` over
  origins, default off. Exclusions vanish from ranking but persist
  in store and trace (`lensExcluded`) — a lens, never a deletion.
- **Familiarity.** Recalled (top 5) / familiar near-miss (next 3,
  labeled "adjacent, not certain") / unranked — three outcomes,
  never laundered. Limits are options (M11e budgets refine them).
- **Trace.** Every row carries `disposition` + `reasons`; the
  result carries gated/lens/demoted/familiar/duplicates/vanished/
  recencyFallback id lists — the substrate M11d renders.

## Verification

- **627 unit green** (44 suites), incl. 11 new rank tests: RRF
  ordering + dedupe, gate/explicit/lock matrix, demote-kept,
  recency overturning surface order, ledger-miss fallback,
  lens exclude/downweight with store untouched, familiar banding,
  near-dup suppression, vanished-row tracing, primitive curves.
- **46 e2e green** (no new HTTP surface; e2e pins module wiring).
- **`tsc` / `eslint` clean.**
