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

## PLANNED - v1.1 Self-Perception & Self-Improvement

The agent turns its attention inward. It observes its own runtime and behavior,
measures what it can actually do against what it assumes, maintains itself, and
— under human approval — proposes and stages changes to its own code. A system
that can inspect, repair, and reproduce itself.

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

## PLANNED - v0.8.1 Agency Extended

Beyond conversation, the agent acts. It executes autonomous actions under
explicit trust and approval boundaries, tends a knowledge base as a living
structure, listens to the physical world through sensors, and reacts to events
without being prompted — with kill-switches and a full audit trail.

- **M22:** Autonomous agent and action execution
- **M23:** Knowledge base stewardship
- **M24:** External sensor support
- **M25:** Reactionary events (ties to M24)

## PLANNED - v0.8 Agency

The agent learns to delegate. Subagents inherit bounded context and capability,
run in parallel, and return verified results — with their own budgets,
permissions, and provenance, so a parent agent can trust what comes back.

- **M21:** Subagent support

## PLANNED - v0.7 Web client bug rollup

A stability pass. The web client catches up with the backend and the
accumulated rough edges are smoothed — no new capabilities, just a surface that
matches what the core can already do, including Discord slash commands.

- **M20:** Web/client surface catch-up

## PLANNED - v0.6 Tools and Skills Expansion

The agent's hands grow. A broad native tool surface — files, web, memory,
vision, image, terminal, processes, scheduling, code execution, and a headless
browser — plus a skill library it can adopt, curate, and load selectively.
Dynamic MCP toolsets make external servers first-class capabilities, without a
restart.

- **M17:** Tool catalog expansion
- **M18:** Skill catalog expansion
- **M19:** Dynamic MCP server toolsets
- **M17.1:** Tools removed from context

## v0.5 Discord & Email Integration

> _Commit 614dcdbf23581a512ee5dd62cab8298a630f5a11_

The agent leaves the chat box. It speaks and listens on Discord and email —
inbound turns, outbound sends, attachments, approval cards, and presence — with
one conversation model spanning channels. Includes vision integration and an
internal URL fix.

- **M16:** External Communications Integration

## v0.4 Epistemic Grounding, Hardening, Roundup

> _Commit 69e4019b09b43083093bc881a1621e0fd7149156_

The agent can consume capabilities from external systems (MCP), hold a
persistent, reviewable identity, and notice when it drifts from it. A
hallucination-mitigation layer adds deterministic checks and an optional second
opinion. A security-hardening pass — authentication, an encrypted vault,
loopback-by-default — makes it safe to actually run.

- Roundup testing completed to mitigate gaps
- Security Hardening slice (07ee4fa8ef2ebb59641c3408c283031aab2d0090)
- **M13:** MCP server support (11f693ae7996f0f47a759de45a4d1ef34502ab9c)
- **M14:** Persistent persona maintenance
- **M15:** Drift detection and reporting (semantic drift is advisory; tuning deferred)
- **M15.5:** Hallucination mitigation (deterministic checks + optional
  provider-agnostic verifier, explicit logged mitigations; blocking
  pre-send mitigation deferred)

## v0.3 Phase 2: Memory Foundations

> _Commit fd2d745fd2b422c9c588874a8599971eb117e412_

The agent forms beliefs. Evidence becomes provenance-traced claims with
human-approved promotion and contradiction handling; those beliefs are recalled
and ranked into context; and they evolve — reinforced, decayed, revised, and
retired — with a walkable history.

- **M10:** Build the epistemic memory
- **M11:** Memory retrieval / application
- **M12:** Memory dynamics

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

> _Commit 224b3860d83be97b99cc8896ff6f7bbb2874896b_

The foundation. A conversation loop, token streaming, persistent sessions with
FTS5 recall, memory-candidate extraction, provider-agnostic LLM access, slash
commands, approvals and clarifications, a filesystem skill catalog, a durable
tool ledger, and a bounded plan → act → observe agent loop. The skeleton of an
agent.

- **M1:** Build core
- **M2:** Streaming
- **M3:** Persistent Session Store + FTS5
- **M4:** Memory Candidate Extraction
- **M5:** External Providers
- **M6:** Interaction protocol
- **M7:** Skills — discovery, retrieval, activation, context injection
- **M8:** Tool integration — reliable, durable, approval-aware execution
- **M9:** Agent Orchestration

---

## Deferred / future (off the main roadmap)

- **M33:** Distributed ICOS
- **M39:** ICOS Ecosystem
- **Episodic consolidation** — abstracting experience into knowledge
- **Source synchronization** — keeping knowledge aligned with the world
