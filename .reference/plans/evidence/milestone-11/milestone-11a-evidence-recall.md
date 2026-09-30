# M11a Evidence — Recall Surfaces

**Date:** 2026-09-30. **Scope:** the three recall surfaces + query
shaping + KB bridge contract, behind one fan-out. No turn wiring
(M11d), no ranking (M11b), no mutation anywhere.

## What landed

- **Lexical (new).** `claims_fts` external-content FTS5 over
  subject/predicate/object/entities_json, trigger-kept
  (`claims_ai/ad/au`, same pattern as `messages_fts`), migration
  rebuild for pre-surface files. `SqliteLexicalClaimIndex`:
  exact-phrase attempt then token-AND fallback; input reduced to
  alphanumeric tokens before touching FTS5 syntax (v2's hyphen
  lesson — quotes, stars, boolean words can neither crash nor
  reinterpret a query); BM25 rank rides through raw for M11b.
- **Semantic (reused, not rebuilt).** The M10d `ClaimIndex` boundary
  (RuVector + fail-closed contract) plugs into the fan-out as-is;
  `ClaimIndexUnavailableError` maps to `available: false` with
  reason `index_unavailable`. No new indexing code; promotion
  already indexes at commit.
- **Associative (new, HRR-lite per M10a).** `AssociativeRecall`:
  stateless full scan over the bounded newest-200 claim window —
  no token table, no backfill, no commit hooks. `resonanceScore` =
  exact token overlap (1.0) + prefix-partial either direction
  (0.5, min-length guarded); tokenizer never stops negation words.
  Status/confidence/provenance never enter the score (linkage only;
  M11b gates). The 200-window is the scale contract, documented at
  the call site for the M11d trace.
- **Query shaping.** `shapeQuery`: trim + 500-char bound, tokens
  attached; slash invocations shape arguments, never the verb;
  empty shapes to empty (surfaces report, M11e flags).
- **KB bridge (reserved contract).** `KbBridge` abstract +
  `NullKbBridge` (name `none`, `available: false`, search `[]`).
  Corpus-absent is a normal flagged state — the M11f KB-absence
  invariant pins this, not silence. M11 owns the band slot, never
  the index (M21).
- **Fan-out.** `RecallService.recall(text, k)` runs
  lexical/semantic/associative + KB in parallel; each surface is
  independently isolated (`available` + `reason`, never throws);
  every hit carries its surface identity (v2's surface trace starts
  here). Wired in `conversation.module`; the conversation path
  takes no dependency on it (M11d owns turn wiring).

## Verification

- **616 unit green** (43 suites), incl. new: tokenize/shape matrix
  (negation kept, command stripping, bounds), lexical exact→AND
  fallback + hostile-syntax battery + pre-surface-file migration,
  resonance weights/partials + seeded reach scenario (shared-token
  hit where no phrase exists), fan-out identity tags + semantic-dead
  isolation + empty-query reporting + KB-absent flag + all-down
  survival.
- **46 e2e green** (no new HTTP surface in this slice; e2e pins the
  module wiring through full boot).
- **`tsc` / `eslint` clean.**

## Notable findings

- **FTS5 external-content footgun (worth knowing).** Non-MATCH reads
  (`COUNT(*)`, bare rowid probes) fall through to the *content*
  table — an empty index reports content counts. A count-compare
  migration therefore never fires. `migrateClaimsFts` rebuilds
  unconditionally while claims exist (idempotent, ms at our scale);
  past ~10k claims this wants a watermark (same scale review as the
  M10a RuVector reopen note). Caught by the migration test, not by
  reasoning — recorded so nobody re-derives it.
- **FTS column names must match the content table.** The index
  column is `entities_json`, not `entities` — external content maps
  by name, and mismatch fails at read time, not DDL time.
- **Associative needs no stored state at our scale.** M10a's
  "SQLite-backed resonance store" is honored as SQLite-*read*:
  same sovereignty, no token table/backfill/commit hooks. The
  dedicated table becomes correct around the same 10k mark — one
  scale review covers both surfaces.
