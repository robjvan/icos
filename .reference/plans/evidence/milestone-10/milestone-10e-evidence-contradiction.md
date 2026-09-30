# M10e Evidence — Contradiction Handling

**Date:** 2026-09-30. **Scope:** narrow conflict definition with an
explicit same-triple negation marker, `prospective_items` storage +
`GET /core/prospective` read API, contradiction→question triggers.
Upstream surfacing (agent questions, UI) stays later work, not M10.

## What landed

- **Negation marker, ledger to belief, end to end.**
  `candidate-validation.ts` accepts `negated: true` only as an
  explicit boolean (truthy strings/numbers never mark; absence reads
  affirmed). Dedup keeps affirmation and negation of one triple as
  rivals. `memory_candidates.negated` (migration-covered, pre-marker
  rows read affirmed), extractor prompt documents the field,
  `conversation.service` passes it through (`?? false` for foreign
  extractors, same precedent as `sourceRole`).
- **Claims carry the marker as identity.** `claims.negated` + the
  uniqueness pair `(identity_key, negated)` (live files migrate:
  column backfill + index rebuild, row data untouched — covered by a
  test that ages a file to the pre-M10e shape and reopens it).
  `findByTriple` matches triple + marker; same-marker duplicates
  still refuse; affirmed/negated rivals coexist as rows.
- **Promotion contradicts on denial, never reinforces it.**
  Same triple text + opposite marker → `CONTRADICT` at proposal and
  at execution (outranks the newest-touch rival), approval text notes
  `(negated — denies the triple)`. Same-marker repeats still
  `REINFORCE` without forking.
- **Prospective queue (storage half).** `prospective_items` table +
  `ProspectiveItemRepository`/`SqliteProspectiveItemRepository`:
  subject/predicate, options (object + origin + confidence +
  claimId), `contestCount`, trigger (`confidence_drop` |
  `repeated_contest`), deterministic template question, `open` /
  `dismissed` (`dismissed` has no writer until later — same
  reservation discipline as M10b `retired`). Repeat contests merge
  into the open row (unseen claim ids append, counter bumps, question
  regenerates); scarred rivals seed the option list so the question
  names every contender, not just the latest round.
- **Triggers.** After each `CONTRADICT` commit: park when the loser
  sits below `MEMORY_PROSPECTIVE_CONFIDENCE_THRESHOLD` (default 0.5,
  `.env.sample` + `config.ts` via `parseScore`) **or** the pair was
  contested before (prior `contradicted`/`retired` scars — in M10
  `retired` is written only by this path, documented at the call
  site). Parking is best-effort like indexing: it never fails a
  commit. `prospective.created` / `prospective.updated` realtime
  events (global fanout, same pattern as `promotion.proposed`).
- **Read API.** `GET /core/prospective` (default `status=open`,
  `dismissed` queryable, `limit` bounded) via `ProspectiveController`,
  wired in `conversation.module`. No context injection: the
  conversation service gains no prospective dependency (only the
  promotion writer holds the repository).

## Verification

- **590 unit green** (39 suites), incl. new: validation marker
  semantics + rival dedup, candidate round-trip + pre-marker reads,
  claim rival coexistence + same-marker refusal + file-shape
  migration, prospective CRUD/merge/persistence, promotion negation
  contradict + same-marker reinforce + low-confidence park +
  confident-first silence + repeat-contest park-and-merge.
- **46 e2e green**, incl. new `contradicts a belief and parks a
  prospective question`: two approved turns → sweep `{contradicted:
  1}` → loser stays queryable under `status=contradicted` →
  `/core/prospective` returns the open `confidence_drop` item with
  both values/origins/confidences and a question naming both →
  ledger row count stable (promotion touches nothing).
- **`tsc` / `eslint` clean.**
- **Live run** (rebuilt container, scratch DBs via compose override —
  `core/.env` untouched): three real turns (OpenRouter chat, local
  gemma extraction). Turn 1 `favourite … TypeScript` → `(user,
  prefers, TypeScript)` conf 1.0 → approved → `NEW`. Turn 2
  `… Rust now, not TypeScript anymore` → the production extractor
  emitted **both** M10e shapes unprompted: `(user, prefers, Rust)`
  affirmed **and** `(user, no_longer_prefers, TypeScript)` with
  `neg=true`. Proposal intent read `CONTRADICT` before execution;
  sweep `{new: 1, contradicted: 1, skipped: 3}`; TypeScript claim
  `active → contradicted` with history intact, Rust active,
  negated-marker claim active under its own predicate. No question
  parked (confident loser, first contest — the negative case
  behaving). Turn 3 `switched to Go` → proposal `CONTRADICT` →
  sweep `{contradicted: 1}` → parked `repeated_contest` item,
  `contestCount: 2`, options TypeScript/Rust/Go with user origins
  and claim ids, question naming all three. Restart: prospective
  item, all 4 claims, 11 ledger rows, and 3 pending journal rows
  intact. Scratch DBs deleted after; no live-DB writes.

## Notable findings

- **Models lexicalize negation into predicates.** The live `neg=true`
  candidate used predicate `no_longer_prefers`, not the same triple —
  so it became a `NEW` claim rather than a same-triple contradiction.
  The marker path triggers when the triple is shared; reworded
  denials fall to different-object conflict (or NEW on new
  predicates). Same-triple negation is covered by unit tests with a
  shared triple; the live run proves marker extraction, not marker
  contradiction. No code change — recorded so M11/M12 don't assume
  one shape.
- **Baked legacy image migrates on boot.** The container image ships
  `data/core.sqlite` (Sept 10); `migrateLegacyDatabase` copied its
  candidates into the scratch DB. Expected, harmless, and a free
  migration-path workout — but live-run candidate polls must filter
  by session.
- **Host model-name drift.** `core/.env` requests
  `gemma4-e4b-unc:latest`; host ollama serves only the full
  `huggingface.co/unsloth/…:Q4_K_M` name → extraction 404'd until
  overridden. Local-env issue, not a code bug; left for the owner
  (did not touch `core/.env`).
- **Web-client realtime mirror deferred.** Core emits
  `prospective.created/updated`; `web-client/.../realtime-event.ts`
  mirrors the union (core authoritative) and its switch ignores
  unknown types — safe no-op until the client adds handling. M10
  touches `core/` + `.reference/` only, so the mirror update rides
  with the web-client's prospective work (phase4 doc already names
  the fourth tab).

## Open for later slices

- M10f: epistemic-invariant sweep over 10a–10e (many bullets already
  covered; needs the explicit mapping pass).
- M11: upstream surfacing of parked questions (agent question / UI),
  recall over the substrate.
- Web-client: mirror the two event types + render the queue.
- M12: `dismissed` writer, per-category lifecycles, revision.
