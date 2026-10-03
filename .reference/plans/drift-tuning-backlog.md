# Drift Tuning Backlog

> Deferred work from **M15e**. M15 shipped a working, measurable drift
> instrument; the calibration showed it is **advisory**, not an alarm. This
> is the list of things to revisit — not now (M15.5 and the platform
> roundup come first), but deliberately parked so nothing is lost.

## Where it stands

On the 21-pair corpus (`.reference/notes/m15e-statement-pairs.md`):

| measure | best F1 | precision | recall |
| --- | --- | --- | --- |
| embedding (floor 0.20) | 0.78 | 0.75 | 0.82 |
| lexical (floor 0.25) | 0.73 | 0.58 | 1.00 |
| structural contradiction | 0.31 | 1.00 | 0.18 |

Distributional distance tracks **topic/tone**, not "did the commitment
change". Known failures:

- **False positives:** tone clarifications (`hide from the world → need a
  break`, signal 0.769, *above every real drift*), and synonyms
  (`careful about money → frugal`, 0.579).
- **False negatives:** subtle value/commitment reversals with shared
  vocabulary (`honesty → loyalty`, `always truth → when convenient`,
  `patient → tedious`).
- **Negation** is caught structurally, not distributionally.

## Backlog

### Corpus

- [ ] Grow well past 21: real revisions from actual use, several
      labellers, and record inter-labeller agreement per pair.
- [ ] Add a rubric clause for **mood/transient vs identity** (the #7 case:
      a statement can be re-expressed more softly without changing the
      belief).
- [ ] Hold out a test split so a floor chosen on one set is validated on
      another.

### Measures

- [ ] **Combine layers**: structural (high precision) + distributional
      (high recall) under an explicit policy (structural overrides;
      distributional advisory). Measure the combined curve.
- [ ] **Try other embedding models** (e.g. bge/e5/nomic, local NLI) and
      re-fit — MiniLM may be the limiting factor.
- [ ] **Proposition-level check**: reverse-entailment / contradiction via a
      small NLI model, which is what actually separates "reworded" from
      "changed the commitment". (Overlaps **M15.5**.)
- [ ] Per-category floors: a boundary change and a tone change should not
      share one threshold.

### Policy / calibration

- [ ] Treat semantic findings as **`watch`/advisory** rather than
      `warning` (or surface them separately from structural alarms).
- [ ] Re-fit the floor and `PERSONA_CUMULATIVE_MIN_CYCLES` on real
      long-run histories, not synthetic streaks.
- [ ] Track F1 over time as the corpus grows (regression on the metric,
      not just the code).

### Harness

- [ ] Fold `tools/score-drift-corpus.cjs` and the corpus spec into a
      repeatable **roundup run** with the platform-wide verification.
- [x] Exercise the embedding path in the suite: `npm test` runs with
      `NODE_OPTIONS=--experimental-vm-modules` (the dynamic-`import` flag the
      ONNX loader needs) and `RUVECTOR_CACHE_DIR=$HOME/.icos/models`, so the
      real embedder runs in jest when the model is available and **skips
      gracefully** when it is not. `tools/score-drift-corpus.cjs` remains for
      the fuller per-measure report.

## Not in scope here

Response/mitigation policy (what the system *does* with a finding) is
**M15.5**. This backlog is about **detection quality** only.
