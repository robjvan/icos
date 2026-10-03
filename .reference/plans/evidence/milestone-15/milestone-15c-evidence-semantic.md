# M15c Evidence — Semantic Drift

**Date:** 2026-10-03. **Scope:** semantic (distributional) drift for a
record whose content changed, with the embedding model when it loads and a
lexical fallback when it does not. Cumulative drift (M15d) is out.

## What landed

- **`persona-semantic.ts`** — pure, deterministic math:
  - `tokenDistribution` + `cosineSimilarity` (direction),
  - `wasserstein1` — the discrete Wasserstein-1 (`½ Σ |p − q|`, unit
    ground cost): 0 identical, 1 disjoint,
  - `normalizedEntropy` — Shannon entropy scaled by `log2(bins)`,
  - `editDistance` (Levenshtein) + `editRatio`, plus `tokenOverlap`,
  - `compareContent(previous, next)` returns the triad + baselines + a
    single `signal`, and flags identical content.
- **`PersonaEmbedder`** boundary (`persona-embedder.service.ts`): an
  abstract `embed(text): Promise<number[] | null>` with a RuVector
  `OnnxEmbedder` implementation that **fails closed** (returns `null`
  when the model cannot load). Tests inject a deterministic fake; the real
  model is not needed in CI.
- **Trend storage**: `persona_drift_trends` (one row per content change,
  auto-numbered review cycle) carrying the triad, baselines, embedding
  cosine, signal, and severity — the raw material for M15d's cumulative
  read. Repository gains `recordDriftTrend` / `listDriftTrends`.
- **`PersonaDriftService.evaluateSemanticChange`**: computes the
  comparison, records a trend every cycle, and raises `semantic_drift`
  at/above the configured floor. The **embedding cosine is the primary
  direction signal when present**; otherwise the token-distribution triad
  drives. Identical content is a no-op. Severity is `warning`, escalating
  to `critical` at the critical floor (the one documented upward
  escalation).
- **Hook**: `PersonaReviewService` evaluates semantic drift when an
  approval updates an existing record (fail-soft — never fails a review).
- **Config / env**: `PERSONA_SEMANTIC_DRIFT_FLOOR` (0.25),
  `PERSONA_SEMANTIC_CRITICAL_FLOOR` (0.5).

## Which measure earns its place

The roadmap asks for the comparison, so it is asserted, not asserted-about:

- A **meaning shift with disjoint vocabulary** (`Be honest about
  uncertainty.` → `Prefer comfortable reassurance over truth.`) yields a
  lexical signal above the floor and raises `semantic_drift`; the trend
  row carries cosine, Wasserstein, entropy, token overlap, and edit ratio.
- A **synonym pair** (`happy` → `joyful`) has *no* token overlap, so the
  lexical triad reads it as maximal drift. The embedding cosine (1.0)
  drives the signal to 0 and **suppresses the false positive**. This is
  the concrete case where embeddings earn their place over the baselines.
- Identical content records no trend and raises no finding.

## Verification

- **943 unit green** (9 new: 6 pure-math + 3 drift-service): Wasserstein
  0/1/partial; entropy degenerate vs uniform; edit distance; the triad +
  baselines together; meaning-shift raises + records a trend; embedding
  suppresses the synonym false positive and raises on an antonym;
  identical is a no-op.
- **63 e2e green.**
- **`tsc` / `eslint` clean.**
- Live note: RuVector's native binding and the ONNX embedder load on the
  host (`isNativeAvailable: true`, 384-d), and the model cache is pinned to
  `RUVECTOR_CACHE_DIR=~/.icos/models`; the earlier "no native backend"
  log was a test double, not a real failure.

## Deferred

**M15d** — cumulative drift across cycles (reads these trend rows).
**M15e** — false-positive/false-negative matrix, UI audit action, and the
milestone verification.
