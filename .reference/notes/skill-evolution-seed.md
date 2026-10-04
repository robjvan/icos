# Skill Evolution — Design Note (deferred)

> Status: **designed, deliberately deferred.** Not scheduled. Captured here so
> the idea is not lost and so it is built with gates rather than on a whim.
> Origin: ICOS lineage — earlier generations used Hermes-style *automatic*
> skill creation/updating and were destabilised by it (skills overwritten on
> the fly; behaviour changed without a reviewable record). This note is the
> response to that failure mode.

## The idea

Let the agent **propose** new skills and updates to existing ones from
experience — mirroring how memory candidates become beliefs — without ever
activating a change silently.

This is attractive: repeated procedures recur, and capturing them lowers
future effort. It is dangerous for the same reason: a skill is instructions
injected into the model's context, so an unreviewed, self-authored skill is
both a behaviour-change vector and a prompt-injection vector (cf. the
skill-registry poisoning seen in always-on harnesses).

## Non-negotiable constraints

1. **Propose, never apply.** Experience yields a **skill candidate**, not an
   active skill. Nothing becomes active on its own.
2. **Human review gates activation.** Default: an active skill exists only
   after review. This mirrors memory promotion and persona review.
3. **Versioned and reversible.** Skills are data (Markdown). An update
   supersedes a version; history is kept; rollback is a first-class action.
   No in-place overwrite.
4. **Capability-bounded.** A skill may declare which tools it may invoke, and
   the tool layer enforces that — never the prompt. (Hard constraints come
   from capability limits, not from instructions.)
5. **Provenance + audit.** Every candidate records its origin (which
   sessions/experiences produced it) and every activation/update/rollback is
   a logged event.
6. **Fail closed.** Malformed or unreviewed skills never load (the existing
   M7 fail-closed validation already applies).

## Proposed pipeline (candidate → active)

```text
experience (sessions, tool runs, repeat procedures)
    ↓  (detector — deterministic where possible, model-assisted as a proposer)
skill_candidate  { name, description, body, tools[], origin[refs], rationale }
    ↓  staged (visible, inert — like a memory candidate)
human review  →  approve | edit | reject | archive
    ↓  (approve writes a NEW version; never overwrites)
active skill (versioned)  ←→  rollback to a prior version
    ↓
injected into context when relevant (existing M7 discovery/activation)
```

## Where it belongs

A **self-improvement** capability, not a runtime one. Natural home is the
M22–M25 band (self-observation → capability registry → self-maintenance →
autopoiesis), or a dedicated *skill-evolution* slice. It should follow both
M16/M19 and the reliability work (identity/drift/verification), because a
gated skill pipeline leans on the same review + audit + provenance machinery.

## Open questions

- **Detector:** purely deterministic (frequency/sequence thresholds) vs a
  model proposing candidates. Prefer deterministic-first, model as proposer.
- **Granularity:** new skills vs edits to existing ones vs parameterisation.
- **Review surface:** extend the existing web review queue (persona/memory
  candidates) or a dedicated Skills review tab.
- **Bounds:** per-session candidate caps, dedup/similarity to avoid proposal
  spam.
- **Evaluation:** how to measure that a proposed skill actually helps
  (before/after task success), and how to detect skill drift over time.

## Explicit non-goals

- No automatic activation, ever (the exact behaviour that destabilised the
  lineage).
- No in-place skill overwrite; no silent version replacement.
- No skill that can escalate its own capabilities.
