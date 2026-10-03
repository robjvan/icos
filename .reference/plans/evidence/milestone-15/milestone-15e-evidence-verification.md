# M15e Evidence — Evaluation + Verification (calibration)

**Date:** 2026-10-03. **Scope:** score the M15 detectors against a labelled
corpus, choose a threshold from data, apply the fixes the probe exposed,
and state honestly what the method can and cannot do.

## Harness

- **Corpus** (`.reference/plans/m15e-statement-pairs.md`, committed): a
  rubric plus **21 labelled `(previous → next)` persona-statement pairs** —
  the author's seven and 14 hard cases (negation flip, priority reversal,
  boundary added, scope narrowed, weakened commitment; benign paraphrase,
  synonym, reorder, elaboration).
- **`persona-drift-corpus.spec.ts`** (deterministic): parses the corpus,
  scores it with the **lexical** triad and the **structural** contradiction
  check, prints the precision/recall curve, and asserts invariants
  (parses; bounded signals; recall non-increasing with floor).
- **`core/tools/score-drift-corpus.cjs`** (real model): the **embedding**
  curve, run under plain node because RuVector's native binding does not
  initialise under ts-jest here (the embedder fails closed to `null` in
  jest).

## Results

Embedding (`1 − cosine`, clamped), n=21:

```
floor 0.15  P 0.67  R 0.91  F1 0.77
floor 0.20  P 0.75  R 0.82  F1 0.78   <- best
floor 0.25  P 0.78  R 0.64  F1 0.70
floor 0.30  P 0.75  R 0.55  F1 0.63
floor 0.35  P 0.67  R 0.36  F1 0.47
```

Lexical (token-distribution signal):

```
floor 0.20  P 0.55  R 1.00  F1 0.71
floor 0.25  P 0.58  R 1.00  F1 0.73   <- best (recall-perfect, noisy)
floor 0.35  P 0.64  R 0.82  F1 0.72
```

Structural (contradiction): **P 1.00, R 0.18, F1 0.31** — precise, narrow.

### What it catches and what it doesn't (embedding at 0.25)

- **Catches** the large movements: wine→never alcohol (0.694),
  share notes→never share (0.685), love→can't stand (0.386),
  scope narrowed (0.359), concise→detailed (0.302), cats→no more pets
  (0.291).
- **Misses** subtle value/commitment changes that share vocabulary:
  honesty→loyalty (0.174), always-truth→when-convenient (0.201),
  patient→tedious (0.142). Topically close ⇒ distributionally close.
- **False positives**: the tone clarification *"hide from the world" →
  "need a break"* (0.769 — **higher than every true drift**), and the
  synonym *"careful about money" → "frugal"* (0.579).

## Findings

1. **Distributional distance tracks topic/tone, not "did the commitment
   change."** That is why no single floor separates the tone FP from the
   real drifts, and why semantic drift is **advisory**, not an alarm. The
   structural layer is the alarm (P 1.00).
2. **Embeddings do not reliably place synonyms close.** The "frugal" pair
   is a counterexample to the earlier claim; embeddings *sometimes* earn
   their place (the TypeScript reword) but not reliably.
3. **Negation is the structural layer's job**, confirmed: the flip
   `Never exfiltrate → Exfiltrate` is caught structurally (P 1.00) even
   though both distributional measures miss it.
4. **Best available balance:** embedding at floor **0.20** (F1 0.78);
   the default was moved 0.25 → **0.20**, documented as provisional.

## Fixes applied

- **Clamp the embedding signal to `[0, 1]`** (`1 − cosine` spans `[0, 2]`),
  so it shares the lexical signal's range and one floor is meaningful;
  unit-tested.
- **Negation ownership documented**: polarity is structural (M15b);
  distributional measures do not model `not`.

## Plan-bullet mapping

| Requirement | Evidence |
| --- | --- |
| Baseline: every failure mode detected at its severity | M15b/c/d tests: core/protected `critical`, identity `warning`, stale/pressure `watch`, low-grounding `warning`, semantic `warning`, cumulative `cumulative` |
| False-positive / false-negative | this corpus + curves above |
| Reconciliation | M15b/M15d: resolved when conditions clear; streak breaks resolve cumulative |
| Isolation: drift writes only the log | M15b `evaluateCandidate` creates no record; `persona-isolation.spec` |
| Live | persona e2e: real candidate vs real core → finding end to end; embedding path exercised live by `tools/score-drift-corpus.cjs` |

## Verification

- **951 unit green** (corpus harness + clamp). **63 e2e green** (run
  sequentially — running unit and e2e concurrently starves the e2e polling
  loops and produces spurious failures).
- **`tsc` / `eslint` clean.**

## Honest limits

- n=21, single labeller, one embedding model (all-MiniLM-L6-v2). The
  numbers are **indicative, not definitive**; the curve will move as the
  corpus grows.
- The method is proven **workable and measurable**, not solved. Subtle
  propositional drift (value/commitment reversals with shared vocabulary)
  is precisely what **M15.5** (claim/evidence consistency + secondary-model
  verification) exists to catch.
