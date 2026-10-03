# Seed — Memory Layers

> **Status:** seed / parked. Not scheduled. Captured 2026-10-03 so the
> intended memory architecture is written down before it is lost.
>
> Open this when it is time to plan the memory patches — after **M15.5**
> and the platform-wide verification roundup, before or alongside **M16+**.
> The architecture will have moved; treat this as intent + pointers, not a
> design.

## Intent

The original goal was four layers, each doing one job:

1. **FTS5 session store** — exact transcript recall (what was said).
2. **Vector store** — semantic recall (what it's about).
3. **HRR associative** — holographic reduced representation: compositional,
   binding-based associative recall (what goes with what, structured).
4. **Temporary scratchpad** — working memory for the current task, evicted
   when the task ends.

## Where ICOS is today

| layer | status | where |
| --- | --- | --- |
| FTS5 session store | ✅ exists | `sessions` DB, `messages_fts` (M3) |
| Vector store | ✅ exists | RuVector claim index, `claims-vector.db` (M10d) |
| Associative recall | ⚠️ exists but **not HRR** | `memory/associative-recall.ts` (term/co-occurrence, not holographic binding) |
| Temporary scratchpad | ❌ absent | — |

Also present: the memory-candidate ledger (M4), epistemic claims with
provenance/contradiction/decay (M10–M12), promotion (M10c), and recall/
ranking/budgeting (M11).

So the gap to the original design is exactly **HRR associative** +
**temporary scratchpad** (and deciding whether HRR *replaces* or
*augments* the existing associative surface).

## What RuVector now offers (mine, don't adopt wholesale)

RuVector has grown well beyond a vector store:

- **AgenticMemory** runtime memory with four layers — working, episodic,
  semantic, procedural recall.
- **Graph + hypergraph store**.
- **Typed persistent agent records**.

These are worth studying for the scratchpad (working) and procedural
layers in particular. **Keep the separation we already have** — the
epistemic memory is ICOS-owned and traceable; coupling core wholesale to
RuVector's runtime would trade our inspectability for features. Mine the
capabilities; keep our boundary.

## Design principles (non-negotiable)

- **Traceability**: every layer's contribution must be visible in one
  place (the recall trace already does this for M11; the scratchpad must
  too).
- **No silent promotion**: scratchpad contents are transient and must never
  leak into durable memory without the normal extraction → review path.
- **Measure, don't assume**: add a layer only if it earns its place against
  the current layers on a task ("which layer actually helps?").
- **One store, one job**: don't let the scratchpad become a shadow
  transcript.

## Open questions for planning time

- Where does the scratchpad live — in-process only, or a bounded SQLite
  table with TTL eviction? (Crash recovery vs simplicity.)
- Does HRR replace `associative-recall.ts`, or sit beside it as a
  structured-recall layer? What does it demonstrably add?
- Do we adopt RuVector's AgenticMemory layer types, or keep ICOS's claim
  model and add *procedural* records alongside it?
- How is procedural memory curated — reviewed like identity, or
  confidence-driven like beliefs?
- Capacity, eviction, and cost bounds for the scratchpad and for HRR.

## Relationship to the roadmap

- Founded by **M10–M12** (epistemic memory, retrieval, dynamics).
- This is a **memory patch**, most naturally planned around the
  self-* / stewardship band (**M21–M24**) or as its own milestone before
  **M34** (cognitive continuity) formalises what must persist.
- The *scratchpad* pairs with **M29** (long-horizon agency) — working
  memory is what a long-running plan needs between turns.
- The *procedural* layer pairs with **M23** (capability assessment) and
  **M21** (knowledge stewardship).

## References

- Current memory code: `core/src/memory/` (associative-recall, recall,
  rank, claim repositories).
- Legacy v2 memory plans: `.reference/legacy/memory-engine/` (UME) — read
  when this is planned, not before.
- Drift/detection context for "does memory help": `.reference/plans/
  drift-tuning-backlog.md`.
