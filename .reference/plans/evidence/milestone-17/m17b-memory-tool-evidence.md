# M17b — Memory tool: live evidence

> Status: **verified** (2026-10-07). Slice **M17b.6** (`memory`). Per-slice
> evidence; M17 itself is still in progress.

## What was built

A native, approval-free `memory` tool (`toolset: 'memory'`) that lets the model
inspect the memory layers manually:

| Layer | Source | Access |
| --- | --- | --- |
| `beliefs` | `claims` (`ClaimRepository`) | direct list/filter; substring match across triple + entities; optional `status` |
| `recall` | `RecallService` (lexical + semantic + associative + KB) | ranked multi-surface retrieval; hits hydrated into belief views, sorted by best raw score |
| `persona` | `PersonaRepository` | core-state metadata + curated records + user facts + relationship |
| `candidates` | `MemoryCandidateRepository` | raw extracted observations, newest-first, **across sessions** |

Validator is strict: `layer` required and enumerated; `query` required for
`recall`; `status` only on `beliefs`; `limit` bounded `1..50` (default 20).

### Design notes

- **Beliefs vs recall.** They are the same underlying claim store. `beliefs` is a
  *direct* query (filter by `status`, substring over the triple/entities).
  `recall` is the *relevance-ranked* multi-surface version (the same pipeline that
  powers the automatic turn-time memory band).
- **Candidates are cross-session.** The raw observation ledger is the useful
  "what has ICOS noticed?" view; each candidate carries its `sessionId` for
  provenance. (Session-scoped would have hidden the whole ledger from a fresh
  session.)
- **Persona is core-only on this host.** `persona_records`, `persona_user_model`,
  and `persona_relationship` are empty; the curated identity lives in the seed
  (`~/.icos/persona/core.md`, 11 entries). The `persona` layer surfaces the
  core-state metadata so the tool explains *what is actually grounding the model*
  rather than appearing to contradict it.

## Unit

| Area | Spec |
| --- | --- |
| Validators (per layer, query/status/limit bounds) | `tool-registry.spec.ts` |
| Execution (beliefs filter, recall hydration, persona, candidates) | `tool-execution.service.spec.ts` |
| Offered-tool surface updated | `conversation.service.spec.ts` |
| E2E tool count (12 → 13) | `test/app.e2e-spec.ts` |

Totals at capture: **1122 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **13 tools**.

## Live

Container rebuilt (`docker compose build core && up -d core`), healthy. One turn
per layer, one tool call per step.

### `beliefs` — query "obsidian"

```
memory {layer: beliefs, query: "obsidian"} → succeeded (2 beliefs)

f0275aac…  preference:Isabel_uses  requires_source_to_verify  strong_preference_to_use_obsidian_vaults  active  fact       agent  1.00
f5fccf46…  person:Isabel           strongly_prefers           obsidian_vaults_for_notes                active  preference user   1.00
```

### `recall` — query "teal notebooks"

```
memory {layer: recall, query: "teal notebooks"} → succeeded (10 ranked)

915ec283…  user  prefers  teal_notebooks  contradicted  conf 1.00   (lexical, score 2.00)
…9 semantic neighbours (scores 0.81–1.07), e.g. system:full_stack_deployment, Docker, memory_service

surfaces: lexical ✓ (1)  semantic ✓ (9)  associative ✓ (1)  kb ✗ (unavailable)
```

The ranked surface is honest about drift: only the lexical hit is topical; the
semantic neighbours are dense-region near-misses, and the model correctly
discounted them.

### `persona`

```
memory {layer: persona} → succeeded

core:        { loaded: true, entryCount: 11, path: "/Users/rob/.icos/persona/core.md" }
records:     []
userFacts:   []
relationship: null
```

The 11 core entries match the `persona_grounding` block the model received —
the tool now accounts for the identity context instead of appearing empty.

### `candidates` — limit 3

```
memory {layer: candidates, limit: 3} → succeeded (3 newest)

preference  person:Isabel  prefers        obsidian_vaults_for_notes  conf 1.0  importance 0.9  assistant  2026-10-07T19:56:41Z
work        todo_list      contains_task  fix the skill files        conf 1.0  importance 0.8  assistant  2026-10-07T19:33:49Z
work        todo_list      contains_task  write the paper            conf 1.0  importance 0.8  assistant  2026-10-07T19:33:49Z
```

Raw ledger rows (pre-promotion), newest first, across sessions.

## Note

One tool call per step again: each layer was its own turn. All four layers
returned `succeeded` in the ledger. The model used `beliefs` for a precise
structured query, `recall` for a fuzzy one, `persona` for identity, and
`candidates` for the raw observation ledger — the intended routing.
