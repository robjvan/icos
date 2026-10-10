# M20.7 — Tools out of context

> Status: **planned** (2026-10-10). Sub-milestone of **M20**. Source:
> `.reference/notes/tools-out-of-context.md` (M20m).

## Objective

Stop injecting every tool schema on every turn. Keep the full tool catalog in
application memory; per turn, inject only a **bounded, relevant** set — a small
always-on core plus deterministically-discovered tools — and give the model an
explicit way to pull more. ~50 builtin tools + MCP tools currently ride every
request; most are irrelevant to any given message.

## Core invariant — discoverability ≠ authorization

Discovery changes **what the model is shown**, never **what the operator
allows**:

- The **operator policy** (`resolveToolPolicy` over the registry) defines the
  universe of enabled tools. Unchanged.
- Discovery selects the **injected** subset **from that universe**. It can only
  narrow, never widen — a discovered tool is by construction already
  policy-enabled.
- **`allowedTools` becomes the injected set** (always-on ∪ discovered ∪
  staged), so the model can only call what it can see. This is a **restriction
  within** the operator's policy, never an expansion of it.
- Every call — discovered, always-on, or pulled — goes through the **existing
  execution + policy-enforcement path** (`ToolRegistry.validate` with
  `allowedTools`, then the normal approval flow). Discovery adds no shortcut,
  no auto-approval, no bypass.
- Tools disabled by policy stay declared in the planning frame ("do not
  propose"), exactly as today.

## Design

### 1. Discovery (deterministic)
`tool-discovery.ts` mirrors `skill-discovery.ts`: pure, no embeddings, no LLM.
Scores the turn input's distinct tokens against each descriptor's **name**
(+2), **toolset** (+2), and **description** (+1); ranks score desc, name asc;
returns up to a limit. Operates over the policy-enabled universe only.

### 2. Selection (budgeted)
`tool-selector.ts`: a `ToolSelector` seam + `TopBudgetedToolSelector` (top-N by
rank), so a future semantic/model selector can drop in without re-plumbing.
Descriptors are the unit; the **wire schemas** are what is budgeted.

### 3. Always-on core
A small **configurable** allowlist (`TOOLS_ALWAYS_ON`), always injected:
`search_platform_tools` (the discovery meta-tool) plus a short core. Kept short
by design — the point is to stop paying for schemas that are rarely relevant.

### 4. Injection is per-turn (bounded)
The injected set = always-on ∪ discovered(input) ∪ staged, capped at
`TOOLS_MAX_PER_TURN`. No unbounded accumulation of discovered schemas across
turns: discovery is recomputed per turn, and a pull is **explicit
reinjection** (see §5). The planning frame lists the injected names + points at
the meta-tool for the rest.

### 5. Pull paths (both)
- **Model-driven:** an always-on `search_platform_tools` meta-tool. The model
  calls it with a query; the harness resolves matches, returns them as the tool
  result, and **reinjects** those schemas on the next proposal round (and, for
  the operator path, the next turn). Bounded by `TOOLS_PULL_MAX_RESULTS` and
  `TOOLS_PULL_MAX_PER_TURN` (repeated-discovery bound).
- **Operator-driven:** `/tools pull <query>` stages matches for the next turn
  (the `/skills pull` analog), plus `/tools` for a read-only inventory/status.
- A pull **stages names**; it does not grant execution. The staged tools must
  be in the operator policy (discovery searches only that universe), and their
  calls still validate + approve normally.

### 6. Bounds
- `TOOLS_MAX_PER_TURN` — injected schema cap (context bound).
- `TOOLS_DISCOVERY_LIMIT` — discovery result cap.
- `TOOLS_PULL_MAX_RESULTS` — meta-tool result cap.
- `TOOLS_PULL_MAX_PER_TURN` — repeated-discovery attempts per turn.

### 7. Config
- `TOOLS_DISCOVERY_ENABLED` (default **true** — the usability benefit is the
  point; a conservative budget is the safety valve). An operator override
  remains to turn it off (falls back to today's inject-everything).
- `TOOLS_ALWAYS_ON` (comma list; default: the meta-tool + a short core).
- the four bounds above.

## Slices

- **M20.7.1 — Discovery + selector + budget.** `tool-discovery.ts`,
  `tool-selector.ts`, always-on + bounds in config; `resolveTools` becomes
  input-aware and returns the narrowed injected set as `allowedTools`; the
  planning frame reflects the injected set; `/status` reports
  injected/total. No pull yet.
- **M20.7.2 — Pull paths.** `search_platform_tools` (meta-tool + per-round
  reinjection) and `/tools pull` + `/tools` (staged, one-shot).
- **M20.7.3 — Surface + settings + docs + evidence.** Client Tools-tab
  discovery state/limits, a settings read-out, `docs/usage.md`, evidence.

## Verification plan

- **Unit:** discovery ranking/recall; selector budget; injection bound;
  always-on inclusion; **permission enforcement** (a policy-disabled tool is
  never injected *or* callable; discovery cannot surface it); tool **collisions**
  (M19 aliases / same name across toolsets); **missing** tool; **unavailable**
  MCP server; **recovery** (a pull reinjects on the next round; a disabled tool
  pulled is still refused); `TOOLS_DISCOVERY_ENABLED=false` restores
  inject-everything.
- **e2e:** a tool absent from the initial schema set is discovered via
  `search_platform_tools`, reinjected, and **executed through the normal
  authorization path** (approval still applies).
- **Live:** a real turn where discovery injects a subset; the meta-tool pulls a
  tool that was not initially offered; the call succeeds; `/status` shows the
  counts.

## Risks

- Changes the tool-offer pipeline in the turn loop (high). Must never corrupt
  structured tool sequences or widen authorization.
- Discovery misses ⇒ the model must pull; the always-on core + the meta-tool
  are the recovery path.

## Decisions (confirmed 2026-10-10)

1. **Pull path:** **both** — a model-callable `search_platform_tools` meta-tool
   *and* an operator `/tools pull`.
2. **Always-on:** a small **configurable** allowlist, including the meta-tool.
3. **Default:** discovery **on by default** with a conservative resource
   budget (bounds above), not opt-in. Keep a config override to disable it.
4. **Scope:** keep as **M20.7**, sliced as above.
5. **Separation:** discovery must not grant permissions, bypass approvals, or
   expand the operator's allowed set; all calls use the existing execution and
   policy-enforcement path.
