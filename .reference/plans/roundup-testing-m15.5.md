# Roundup Testing — Verified Reality at M15.5

> **Cross-cutting verification pass** (like `security-hardening.md`), not a
> numbered cognition milestone. Origin: `.reference/roundup-testing/idea.md`
> — _"fully verify all claims, functionality, and abilities of the platform
> as of the completion of M15.5."_
>
> Scheduled between **M15.5** and **M16**. It adds no product capability; it
> establishes, with evidence, what is actually true about the system before
> the next layer is built on top of it.
>
> **Status: complete 2026-10-03.** Evidence:
> `.reference/plans/evidence/roundup-testing/roundup-m15.5-evidence.md`.

## Objective

Independently re-verify every load-bearing claim the repository makes about
itself — in `README.md`, `docs/`, and the milestone evidence — and every
user-facing ability the runtime exposes, against the **actually running**
system. Where reality and documentation disagree, either fix the system or
correct the claim. Produce one honest register that a new reader (or Rob in
six months) can trust.

### Research question

> At the end of M15.5, is every capability the project claims actually
> present and working, and is every claim it makes actually supported by
> committed evidence — or are there quiet gaps between the story and the
> software?

## Why this is not just "run the tests"

The unit and e2e suites are **mocked** at the model boundary. They prove
internal consistency, not external behaviour. This pass adds:

- a **claim register** — prose claim → the evidence that backs it → verdict;
- an **ability register** — endpoint/mechanism → the test that proves it →
  verdict;
- **live probes** where the environment allows (boot the stack, real HTTP,
  the live Jev verifier);
- **fixes** for every discrepancy found, each with its own test.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **verified** | backed by a committed test or reproducible live run |
| **partial** | works, but weaker than the claim (e.g. advisory, mocked-only) |
| **gap** | claimed or listed but not actually present/working |
| **stale** | documentation lags reality (e.g. a completed milestone unlisted) |
| **overstated** | the claim is stronger than what the system guarantees |
| **unverifiable (env)** | true in intent, but cannot be checked here (needs hardware/provider) |

A finding is only **closed** when it is either fixed in code or corrected in
prose, with the change committed.

## Scope

**In:** M1–M15.5 — the conversation loop, streaming, sessions, extraction,
providers, interaction protocol, skills, tools, orchestration, epistemic
memory (M10–M12), MCP, persona (M14), drift (M15), hallucination mitigation
(M15.5); the security-hardening pass (S1–S6); the web client surfaces; the
compose launch path; `README.md`, `docs/`, `USAGE.md`, `INDEX.md`.

**Out:** M16+ (nothing there is claimed yet); the core-provenance-integrity
hardening plan (a separate future slice); anything the plans explicitly
defer (blocking pre-send mitigation, Linux CUDA verifier, drift tuning).

## Slices

# [x] R1 — Baseline (the system is green)

- [x] Unit, e2e, and live suites run clean; record exact counts and versions.
- [x] `tsc` and `eslint` clean.
- [x] The supported launch path (`docker compose`) builds and boots a healthy
      `core`.
- [x] Boot-time invariants hold: fail-closed core persona, auth defaults,
      vault, migrations.

# [x] R2 — Ability register (it does what it says)

- [x] Enumerate every HTTP route and every non-HTTP mechanism.
- [x] Map each to the test(s) that prove it; flag anything with no proof.
- [x] Live-probe the surfaces that can be exercised locally.

# [x] R3 — Claim register (it says what is true)

- [x] Extract every explicit capability/status claim from `README.md`,
      `docs/`, `USAGE.md`, `INDEX.md`.
- [x] Back each with evidence; verdict per the vocabulary above.
- [x] Correct stale/overstated prose.

# [x] R4 — Gap fixes

- [x] Fix every **gap** and **overstated** finding (system or prose), each
      with a test or an explicit downgrade of the claim.

# [x] R5 — Roundup evidence

- [x] Commit the registers and the fix list as roundup evidence.
- [x] State plainly what remains partial, unverifiable, or deferred.

## Definition of Done

> Every claim in `README.md`, `docs/`, and the committed evidence has been
> checked against the running system and carries a verdict; every exposed
> ability has a proof or a noted gap; all gaps are fixed or their claims
> corrected; the baseline is green; and the result is committed as evidence
> with clean `tsc` and `eslint`.
