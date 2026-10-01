# M12c Evidence — Revision and Supersession

**Date:** 2026-10-01. **Scope:** standing-pair resolution,
certainty lifecycle, source classification, reliability tracking,
clarification completion. No belief creation (promotion stays the
only birth), no graph traversal, no UI changes.

## What landed

- **Winner-picking revision.** Maintenance detects standing
  active-active rival pairs (promotion converges at commit time;
  this rung catches races, negation transients, legacy rows) and
  applies the fixed policy — human-approved authority, then
  corroboration count, then recency, then id for total order. The
  loser goes `contradicted` with history intact (M10e kept);
  both sides link `related[]` and record `revise` rows; winner
  sources accrue wins, loser sources losses. One active head per
  triple after. Ladder appended after gist (detection before
  resolution); existing relative order preserved.
- **Stale-read guard.** Revision re-reads each claim before acting:
  an earlier record in the same pass may have resolved it. Caught
  by test (double revision + double reliability counts), fixed,
  documented at the call site.
- **Certainty lifecycle.** Lock at ≥5 observations + ≥0.9
  confidence (guards decay, never revision or growth); a locked
  loser unlocks with history. Counted under `locked`.
- **Source classification.** First-stamp-wins rule (user +
  high extractor confidence → direct_statement; mid →
  inference; low → speculation; machine-made caps at inference —
  an agent statement is never direct testimony), with a new
  `classify` history transition (claim_history CHECK migrated via
  table rebuild, rows preserved).
- **Reliability.** `source_reliability` store keyed
  `role/model` of first evidence; revision outcomes accrue
  wins/losses. Influence is Laplace-smoothed and
  punishment-only (neutral/winning → 1.0, losing → toward 0.5).
  M11 ranking multiplies fused scores by sub-1.0 factors with
  the factor in the row reasons (the M12f trace requirement);
  no-record sources are untouched, so M11 behavior is identical
  without data. Agent dampening (`MEMORY_AGENT_DAMPENING`,
  default 0.5): agent-origin claims compound at the fraction,
  recorded in history detail.
- **Clarification completion.** `POST /core/prospective/:id/
  resolve` (confirmed | corrected | dismissed + optional note):
  terminal `dismissed` with resolution + timestamp, `revise`
  history rows (with outcome + note) on every involved claim. A
  correction is noted with full provenance — the belief update,
  if any, travels promotion later, never the endpoint. Missing →
  404, closed/unknown → 400. This is the writer M10e reserved
  `dismissed` for.
- **Invalidate-prep note.** Evidence invalidation (retracted
  sources) is designed but not built here: it needs the same
  revision machinery plus a retraction source that doesn't exist
  yet (no session-retraction API). Parked for M12e-or-later with
  the design recorded, not half-built.

## Verification

- **687 unit green** (core), incl. policy order matrix,
  end-to-end revision with links/history/reliability counts,
  lock/unlock lifecycle, classification rules + once-only,
  dampened compounding, rank reliability factors + neutrality,
  resolve terminality, lock/sourceType repository isolation.
- **48 e2e green**, incl. resolve flow (parked item → confirmed
  → dismissed with per-claim history → re-resolve 400 → 404).
- **168 client green** (mirror gained `resolution` fields only).
- **`tsc`/`eslint` clean both projects.**
- M12a/b suites updated where the extended ladder
  legitimately moves claims (second-pass `skipped` →
  `classified`); M12a/b evidence stands as written.

## Notable findings

- **Same shape, two meanings.** Active-active same-triple pairs
  are both gist families (M12a) and revision targets. The ladder
  orders detection before resolution; a family later resolved
  keeps its proposal as the observation. Inherent to the model,
  not a bug — promotion treats the shape identically.
- **Same-triple negation in rank.** Negated rivals share text;
  the near-dup suppressor keys on text + marker, so genuine
  rivals survive suppression while true duplicates still merge.
