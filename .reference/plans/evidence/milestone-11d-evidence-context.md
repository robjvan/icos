# M11d Evidence — Memory-Aware Context Construction

**Date:** 2026-09-30. **Scope:** turn-time recall wiring, band
separation, access observation, recall trace. No budgets (M11e),
no resolution (M12), no UI (later).

## What landed

- **Turn hook.** `prepareTurn` runs recall → rank → compare once
  per turn (filling the `memory.recall` TODO in `prepareMessages`);
  bands enter `buildContext` as system-scope messages after the
  system head, before history. Empty recall yields byte-identical
  pre-M11 context (every pre-existing context test passes
  untouched). Recall failure degrades to bare context with a
  `recall_error` trace — never fails a turn (floor; M11e
  formalizes).
- **Band separation.** Memory band: recalled lines with origin +
  confidence each, contradicted flagged, conflicts inline,
  near-misses in an uncertain voice, negated claims as
  `not "X"`. KB band: present only with hits. User band raw and
  last. If a provider ever forces one string, the `[memory:…]` /
  `[knowledge-base:…]` delimiters preserve the bands textually,
  and the artifact retains them separately.
- **Anti-laundering (the key interface rule).** Bands live only in
  assembled LLM messages; the transcript writes user + assistant
  texts only, and extraction input is built from the transcript
  store — never the assembled prompt. Unit-pinned: extractor input
  on an augmented turn contains no band text and no recalled
  content beyond what the turn itself said; assistant restatements
  keep flowing through the M10b origin stamp (`role: assistant`).
- **Access observation.** `ClaimRepository.recordAccessed`
  (bump + touch, missing ids ignored) — the one mutation M11 is
  granted, fired post-commit for recalled + familiar rows,
  fire-and-forget like extraction. Belief fields provably
  untouched.
- **Trace.** `RecallTraceStore` (bounded 100, process-local,
  restart-ephemeral by design) + `GET /core/recall/trace?sessionId=`
  (404 when absent): query, per-surface availability/counts/
  reasons, ranked dispositions with reasons, notes, proposed
  questions, lens, gate, band flags, degraded list.
- **Lens config.** `MEMORY_RECALL_EXCLUDE_ORIGINS` (default empty;
  unknown values fail startup). Wired per turn into ranking.
- **Proposals stay recommendations.** Comparison's proposed
  questions surface in the trace only — no auto-parking. Recall-time
  writing would re-park every stable conflict and unwind M10e's
  trigger policy; parking stays promotion's job.

## Verification

- **649 unit green** (47 suites): band builders (labels, flags,
  negation, near-miss voice, null emptiness), builder insertion
  order + byte-identity, trace store bounds, `recordAccessed`
  isolation, six turn tests (band injection, anti-laundering,
  access + trace, lens plumbing, recall-failure degradation,
  command bypass).
- **47 e2e green**, incl. trace endpoint (populated after a turn,
  404 on unknown session).
- **`tsc` / `eslint` clean.** Live leg deferred to M11f (milestone
  DoD), which exercises recall against seeded beliefs end to end.
