# Release History

> Each release leads with a short description suitable for the release page;
> the milestone list below it is the changelog. Planned releases are marked
> **PLANNED**. Released entries carry the commit they were cut from.

## PLANNED - v1.3 Open-Ended Inquiry

The agent stops waiting to be asked. It acquires knowledge from open sources,
directs its own research, and asks questions nobody put to it — while staying
honest about what it does not know. Continuity carries its identity across model
and hardware changes, and the system re-examines its own assumptions to define
its next generation.

- **M36:** Open-Ended Knowledge Acquisition
- **M37:** Self-Directed Research
- **M38:** Continuity
- **M40:** Open-Ended Research

## PLANNED - v1.2 Cognitive Expansion

The agent learns from experiment and holds goals over long horizons. It routes
tasks across specialist models, runs controlled experiments to test hypotheses,
and keeps a plan alive across days — turning experience into knowledge, and
disagreement between models into signal rather than noise.

- **M30:** Experimental Learning
- **M31:** Multi-Model Cognition
- **M32:** Long-horizon Agency

## PLANNED - v1.1 Perception & Self-Improvement

The agent turns its attention inward. It observes its own runtime and behavior,
measures what it can actually do against what it assumes, maintains itself, and
— under human approval — proposes and stages changes to its own code. A system
that can inspect, repair, and reproduce itself.

- **M24:** External sensor support
- **M25:** Reactionary events (ties to M24)
- **M26:** Self-Observation and Introspection
- **M27:** Self-Evaluation and Capability Assessment
- **M28:** Self-Maintenance
- **M29:** Autopoiesis

## PLANNED - v1.0 Release

The agent is deployable and usable end-to-end. It communicates across channels,
wields a broad tool and skill surface, manages its own MCP toolsets, and
presents a stable web client — all on a hardened, provider-agnostic core. This
is the first release we would call finished: the "put the agent into an
environment" phase, complete.

## PLANNED - v0.7.1 Agency Extended

Beyond conversation, the agent acts. It executes autonomous actions under
explicit trust and approval boundaries, tends a knowledge base as a living
structure, listens to the physical world through sensors, and reacts to events
without being prompted — with kill-switches and a full audit trail.

- **M22:** Autonomous agent and action execution
- **M23:** Knowledge base stewardship

## PLANNED - v0.7 Agency

The agent learns to delegate. Subagents inherit bounded context and capability,
run in parallel, and return verified results — with their own budgets,
permissions, and provenance, so a parent agent can trust what comes back.

- **M21:** Subagent support

## v0.6 Tools and Skills Expansion, Feature Rollup

The agent's hands grow. A broad native tool surface — files, web, memory,
vision, image, terminal, processes, scheduling, code execution, and a headless
browser — plus a skill library it can adopt, curate, and load selectively.
Dynamic MCP toolsets make external servers first-class capabilities, without a
restart.

The web client gets a stability pass and catches up with the backend and the
accumulated rough edges are smoothed — no new capabilities, just a surface that
matches what the core can already do, including Discord slash commands.

- **M17:** Tool catalog expansion (1c20df826be0aaf1ac713017a2c405c1502a447e)
- **M18:** Skill catalog expansion (240aefa12c9f17ef3186e1c1152e0ad0871fe14d)
- **M19:** Dynamic MCP server toolsets (8a28d81cda1c57f5e457e09eb5e75001898680ee)
- **M20:** Web/client surface catch-up (d1d49284888ce668a099ac0dadd5adc8103f905d)
  - Automatic context compaction (996a3a80caa6bc240dd84f9870c1936dff261d5e)
  - Tools removed from context (d1d49284888ce668a099ac0dadd5adc8103f905d)

## v0.5 Discord & Email Integration

The agent leaves the chat box. It speaks and listens on Discord and email —
inbound turns, outbound sends, attachments, approval cards, and presence — with
one conversation model spanning channels. Includes vision integration and an
internal URL fix.

- **M16:** External Communications Integration (614dcdbf23581a512ee5dd62cab8298a630f5a11)

## v0.4 Epistemic Grounding, Hardening, Roundup

The agent can consume capabilities from external systems (MCP), hold a
persistent, reviewable identity, and notice when it drifts from it. A
hallucination-mitigation layer adds deterministic checks and an optional second
opinion. A security-hardening pass — authentication, an encrypted vault,
loopback-by-default — makes it safe to actually run.

- Roundup testing completed to mitigate gaps
- Security Hardening slice (07ee4fa8ef2ebb59641c3408c283031aab2d0090)
- **M13:** MCP server support (11f693ae7996f0f47a759de45a4d1ef34502ab9c)
- **Security Hardening:** (07ee4fa8ef2ebb59641c3408c283031aab2d0090)
- **M14:** Persistent persona maintenance (d5df3632c6e26307dc2b8f6e5c4e7922b5eecfc1)
- **M15:** Drift detection and reporting (semantic drift is advisory; tuning deferred) (671e1f3f7bdc3cdeddc1e0ddacc858cd7d712a6c)
- **M15.5:** Hallucination mitigation (deterministic checks + optional
  provider-agnostic verifier, explicit logged mitigations; blocking
  pre-send mitigation deferred) (d090d9068c7a508a63ca2d1c0834711c7662f6e7)
- **Roundup:** (69e4019b09b43083093bc881a1621e0fd7149156)

## v0.3 Phase 2: Memory Foundations

The agent forms beliefs. Evidence becomes provenance-traced claims with
human-approved promotion and contradiction handling; those beliefs are recalled
and ranked into context; and they evolve — reinforced, decayed, revised, and
retired — with a walkable history.

- **M10:** Build the epistemic memory (10a10ad211e38d1967fd72e53e33121d0a2834c3)
- **M11:** Memory retrieval / application (1d9e65559bc7174db918d99122e2319f9765e663)
- **M12:** Memory dynamics (fd2d745fd2b422c9c588874a8599971eb117e412)

## v0.2.1 Realtime Web Client

> _Commit 928f10554fdc6deac8e3ee16d142659b2746246b_

A realtime layer. Token streaming over SSE, live session updates, and
approvals/clarifications delivered as structured events — the client stops
polling and starts listening.

## v0.2 Web Client

> _Commit 97ff9fb2c6dd08dd0b2916ab9a17da88efe64c1f_

ICOS gets a face. A same-origin web client for conversations, sessions, memory
review, and the approval/clarification surfaces — the first real operator
interface.

## v0.1 Phase 1: Foundation

The foundation. A conversation loop, token streaming, persistent sessions with
FTS5 recall, memory-candidate extraction, provider-agnostic LLM access, slash
commands, approvals and clarifications, a filesystem skill catalog, a durable
tool ledger, and a bounded plan → act → observe agent loop. The skeleton of an
agent.

- **M1:** Build core (edebc6e291198616b9491645987b8ca2db677586)
- **M2:** Streaming (a6fd85acf66f681aea9bdde510f15adec5a863a5)
- **M3:** Persistent Session Store + FTS5 (7329d8cf7a3ccb7bcdb75d3b62c19a64485cfd75)
- **M4:** Memory Candidate Extraction (ad710aa24c53e71d02f6784dc70628c51076a0ed)
- **M5:** External Providers (df7950e4301a67b18276073bbe9bfc7bbd83fb2b)
- **M6:** Interaction protocol (8399ca4f5631ee99ee154fcfa10c4150b4e693b6)
- **M7:** Skills — discovery, retrieval, activation, context injection (8d8efdd5e183e97ee27aab4f8311fa82150b0eab)
- **M8:** Tool integration — reliable, durable, approval-aware execution (1ad97a207f03e7b0628e6f9194352fd665c80ae1)
- **M9:** Agent Orchestration (2e7fc516e5a5b8ebb3464a3380f932abb8317405)

---

## Deferred / future (off the main roadmap)

- Temporary Memory Scratchpad
- **M33:** Distributed ICOS
- **M39:** ICOS Ecosystem
- **Episodic consolidation** — abstracting experience into knowledge
- **Source synchronization** — keeping knowledge aligned with the world
