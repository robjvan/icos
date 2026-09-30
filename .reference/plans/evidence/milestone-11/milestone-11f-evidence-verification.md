# M11f Evidence — Retrieval Verification

**Date:** 2026-09-30. **Scope:** bullet-by-bullet mapping over
M11a–M11e plus the live leg (host-run core, scratch DBs, OpenRouter
chat + local gemma extraction, real RuVector embeddings).

## Bullet mapping

- **Recall precision.** Unit: exact-phrase → token-AND fallback,
  paraphrase-shaped semantic reuse, seeded resonance reach with
  lexical + semantic silent. Live: exact ("favourite programming
  language?") and paraphrase ("which language do I code in?")
  both recalled the seeded TypeScript belief and both answers
  came out right — the paraphrase reply even cited the band
  metadata. **Limitation, recorded:** on the exact query the
  agent-mined chatter claim ranked *first* (vector distance luck
  at 2-claim scale). Recalled-and-correct holds; strict top-rank
  ordering over tiny stores does not always. Not blocking: M11b
  pins ordering determinism, and volume + gates decide ranks in
  practice.
- **Gate honesty.** Unit matrix: below-gate excluded + traced,
  `includeGated` override labeled, `locked` bypass. No live gate
  leg (a sub-threshold belief cannot be seeded honestly through
  the extractor) — recorded, not hidden.
- **Band separation.** Unit: band order/labels, byte-identity on
  miss, transcript holds turn rows only. E2E: exact-context
  assertions incl. the active-miss marker. Anti-laundering pinned
  at turn level (extractor input band-free). Live: every probe
  answer drew on band content visibly.
- **Lens behavior.** Unit: exclude/downweight with store
  untouched. Live: restarted with `MEMORY_RECALL_EXCLUDE_ORIGINS=
  agent` → agent claim `excluded` with `lens:<id>` in degraded,
  user claim recalled, store intact at 2 claims.
- **Familiarity.** Unit: 5/3/1 banding with near-miss labels.
  No live leg (precise fused-score control isn't seedable live).
- **Degradation.** Unit: semantic-dead, lexical-dead, all-down
  matrices; timeout race; partial-recall silence. Live: RuVector
  backend healthy (semantic `available: true` with real hits on
  every probe); KB bridge absent throughout.
- **Budget.** Unit: order-exact shrink sequence, notes survive,
  user band untouched, dropped rows unobserved. No live leg
  (cap 800 never binds a 2-claim store).
- **Associative reach.** Unit seeded scenario. Live: the
  paraphrase probe carried an associative hit alongside semantic
  (shared `code` token) — resonance contributing, not deciding.
- **KB absence.** Null bridge unit-pinned; live traces flagged
  `kbAvailable: false` on every turn with no corpus, turns clean.
  **Gap found in this pass:** the trace never recorded KB
  availability (band omitted, nothing said corpus-absent). Fixed:
  `kbAvailable` on the trace (both paths), specs updated.

## Live leg transcript (scratch, destroyed after)

Seeded via real turns (3 topics) → approved `NEW` ×2 (user
preference conf 1.0, agent-mined chatter conf 0.9; one approval
bound to the wrong session by operator script error — stayed
pending, swept past, harmless). Probes: exact recall (semantic
2 hits, lexical 0, associative 0 — phrase tokens absent from the
triple, as designed), paraphrase (semantic 2 + associative 1),
unrelated Assyria query (answered from general knowledge; band
carried both claims — semantic top-k is indiscriminate at this
scale, an honest consequence of gateless relevance, not a bug).
Access counters ticked per probe turn (`accessCount` 4–5,
`lastAccessedAt` set). Lens restart probe as above.

## Totals

656 unit green (47 suites), 47 e2e green, `tsc`/`eslint` clean,
live precision + lens + absence legs above. M11 definition of done
is met: beliefs recall at turn time, ranked, compared, banded,
traced — claims immutable throughout (no claim mutation exists
outside promotion/M12 paths; `recordAccessed` is the sole M11
writer and touches counters only).
