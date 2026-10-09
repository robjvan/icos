<div align="center">

<img src=".reference/plans/brand/icos-app-icon.svg" height=180px>
<br><br>

# ICOS

![Commits](https://img.shields.io/github/commit-activity/t/robjvan/icos?logo=github)
![LastCommit](https://img.shields.io/github/last-commit/robjvan/icos?color=CBA701&logo=github)

![LatestRelease](https://img.shields.io/github/v/release/robjvan/icos?include_prereleases)

![Tests](https://img.shields.io/badge/Tests-All%20Green-green?logo=jest)
![Tests](https://img.shields.io/badge/Functions%20Coverage-84.7-green?logo=jest)
![Tests](https://img.shields.io/badge/Lines%20Coverage-82.9-green?logo=jest)

![Tests](https://img.shields.io/badge/Unit%20Tests-994-green?logo=jest)
![Tests](https://img.shields.io/badge/E2E%20Tests-93-green?logo=jest)
![Tests](https://img.shields.io/badge/Web%20Tests-185-green?logo=jest)

![Node.js](https://img.shields.io/badge/Node.js-24.x-red)
![NPM](https://img.shields.io/badge/npm-11.x-CB0200?logo=npm&logoColor=CB0200)
![NestJS](https://img.shields.io/badge/NestJS-11.0.1-EA2F59?logo=nestjs&logoColor=EA2F59)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-blue?logo=typescript)
![Angular](https://img.shields.io/badge/Angular-21.x-DD0031?logo=angular&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

![REST](https://img.shields.io/badge/REST-API-lavender)
![SSE](https://img.shields.io/badge/Streaming-SSE-lavender)
![Realtime](https://img.shields.io/badge/Realtime-WebSocket-lavender)
![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-steelblue?logo=openaigym)
![Providers](https://img.shields.io/badge/LLM-Provider--Independent-blueviolet?logo=lmstudio)
![MCP](https://img.shields.io/badge/MCP-Client-5A67D8)

![SQLite](https://img.shields.io/badge/SQLite-FTS5-90D4F4?logo=sqlite&logoColor=90D4F4)
![Memory](https://img.shields.io/badge/Memory-Epistemic%20%7C%20Experimental-purple)
![Persona](https://img.shields.io/badge/Persona-Persistent-purple)
![Provenance](https://img.shields.io/badge/Provenance-Tracked-purple)

![Self-hosted](https://img.shields.io/badge/Self--hosted-yes-green)
![Local-first](https://img.shields.io/badge/Local--first-yellowgreen)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-lightgrey)
[![Architecture](https://img.shields.io/badge/Docs-Architecture-informational)](ARCHITECTURE.md)
![License](https://img.shields.io/badge/License-PolyForm%20NC%201.0.0-blue)

![Github](https://img.shields.io/badge/Coffees-Many-88502A?logo=coffeescript&logoColor=white)

</div>

---

## What is ICOS?

**ICOS** (**I**SABEL **C**ognitive **O**perating **S**ystem) is a from-scratch cognitive agent runtime built to investigate a simple question:

> **What is the minimum architecture required to give an agent persistent memory, useful knowledge, and meaningful agency?**

ICOS is not a wrapper around an existing agent framework.

**The runtime is the harness.**

The agent loop, interaction layer, model boundary, session persistence, memory systems, skills, and future autonomous capabilities are being developed as parts of one deliberately small system.

The goal is not to reproduce a biological model of cognition. Instead, ICOS is an experimental platform for identifying which architectural mechanisms actually produce useful changes in agent behaviour.

> **Trying it out?** Start with **[USAGE.md](USAGE.md)** (setup, configuration,
> and running the stack). Before exposing it beyond your machine, read
> **[docs/security.md](docs/security.md).** To understand what the platform
> actually does — feature by feature, and how each is verified — read
> **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Lineage

ICOS is the third generation of a personal cognitive-architecture research
line — hence "v3", which refers to the _generation_, not to ICOS's own
version. ICOS is the first release under its own name.

| Generation | Name       |                                              |
| :--------: | :--------- | :------------------------------------------- |
|     v1     | **AURORA** |                                              |
|     v2     | **ISABEL** | A large, biologically inspired architecture. |
|     v3     | **ICOS**   | **ISABEL Cognitive Operating System**.       |

ISABEL (v2) explored a much more elaborate approach to cognitive architecture, incorporating biologically inspired mechanisms including persistent identity, multiple memory systems, state modulation, autonomous action selection, knowledge structures, and more.

That work was valuable, but it also exposed a problem:

**As the architecture became more complex, the architecture itself became a confounding variable.**

When an agent changed its behaviour, it became increasingly difficult to determine whether the change came from a particular mechanism or from its interaction with everything surrounding it.

ICOS takes the opposite approach.

Start small.

Add capabilities deliberately.

Measure what changes.

Keep the system understandable.

> **If a capability cannot justify its complexity, it doesn't belong in the architecture yet.**

---

## Design Goals

ICOS is being built around a few principles:

### Small enough to understand

The core should remain small enough that the entire agent loop can be understood without reconstructing a distributed system.

### Provider independent

The agent should not be coupled to a particular model provider.

ICOS communicates through an OpenAI-compatible interface, allowing the underlying model to be changed without rebuilding the runtime around it.

Current and planned providers include local and external model backends such as Ollama, llama.cpp, OpenCode, and OpenRouter.

### Evidence-driven

Capabilities are introduced incrementally.

Each milestone has a specific question, implementation target, and verification evidence.

The intention is to understand not only **whether something works**, but **what changed when it was introduced**.

### Experimental rather than general-purpose

ICOS is not intended to compete with general-purpose agent frameworks.

It exists primarily as a controlled environment for experimenting with agent architecture.

---

## Current Status

**M1–M19 are complete, and the security-hardening milestone (S1–S6) is complete.**

The current system provides:

- A working conversation loop
- REST API
- Token streaming via SSE
- Persistent SQLite sessions
- FTS5 session recall
- Memory-candidate extraction
- An evidence ledger for extracted candidates
- Provider-independent LLM integration
- Slash commands
- Structured human approvals
- Structured clarification requests
- Standard-format skills support
- Tool integration with a durable invocation ledger
- Agent orchestration (bounded plan → act → observe loop)
- Epistemic memory (evidence → provenance-traced beliefs, human-approved
  promotion, contradiction handling with a clarification queue)
- Turn-time recall (lexical + semantic + associative surfaces, ranked
  with confidence gating and provenance lenses, band-separated context
  that never confuses memory with user speech)
- Memory dynamics (bounded reinforcement, honest decay, revision with
  walkable history, deliberate retirement, salience apart from truth,
  temporal navigation)
- Contradiction transparency in the web client (paired belief links,
  negation markers, parked-question surfacing)
- MCP client support (consumes standard Model Context Protocol servers:
  namespaced tools bridged into the agent loop, approval-gated execution
  with durable records, resources and prompt templates behind a
  read-only fetch surface, no-restart catalog reload, per-server health)
- A persistent persona (an immutable, file-backed core the system cannot
  rewrite, an evolving reviewed identity / user / relationship layer,
  grounding into session context, and a review queue in the web client)
- Drift detection (structural signals plus an honestly-calibrated,
  advisory semantic signal, with finding reconciliation and a reporting
  surface)
- Hallucination mitigation (deterministic claim/evidence consistency
  checks, optional provider-agnostic secondary-model verification whose
  disagreement is recorded rather than auto-resolved, and explicit,
  logged mitigations — never a silent rewrite)
- Security posture (loopback-by-default binding, authentication with a
  bootstrap token, an encrypted secret vault, and an LLM provider
  registry selected at runtime with key references resolved through the
  vault) — managed from the web client (MCP servers, providers, secrets)
- External channels (Discord + email): inbound turns, outbound sends,
  attachments, approval cards, and status/presence
- An expanded tool surface (25 native tools): files, web search/extract,
  skills (view/list/manage), todo, memory (beliefs / ranked recall /
  persona / candidates), clarify (park/resume), vision_analyze, image
  generation, terminal, background processes, Discord info/moderation,
  a durable cron scheduler, execute_code (with a tool-RPC bridge), and a
  headless browser — plus attachment vision and a generic native
  approval path

Development is active and the architecture is expected to change substantially as new capabilities are introduced.

---

## Milestone Goals

ICOS is being developed as a sequence of increasingly capable experiments.
Each milestone states a **goal** — a capability to reach, not a claim to defend.

|  Milestone   | Goal                                                                    |
| :----------: | :---------------------------------------------------------------------- |
|    **M1**    | Establish the core conversation loop.                                   |
|    **M2**    | Stream responses token by token.                                        |
|    **M3**    | Persist and search conversation history.                                |
|    **M4**    | Extract candidate memories from turns.                                  |
|    **M5**    | Swap LLM providers without touching core.                               |
|    **M6**    | Structured human interaction: commands, approvals, clarifications.      |
|    **M7**    | Acquire skills from a filesystem catalog.                               |
|    **M8**    | Execute tools reliably, durably, and with approval.                     |
|    **M9**    | Complete tasks autonomously via an agent loop.                          |
|   **M10**    | Form durable, provenance-tracked knowledge.                             |
|   **M11**    | Retrieve and apply knowledge in context.                                |
|   **M12**    | Let knowledge evolve: consolidation, decay, revision.                   |
|   **M13**    | Use capabilities provided by external systems (MCP).                    |
|   **M14**    | Maintain a persistent, reviewable persona.                              |
|   **M15**    | Detect and report identity drift.                                       |
|   **M16**    | Communicate through external channels.                                  |
|   **M17**    | Expand the tool surface.                                                |
|   **M18**    | Adopt a broader skill library.                                          |
|   **M19**    | Dynamic MCP server toolsets.                                            |
|   **M20**    | Catch the web client up, including Discord slash commands.              |
|   **M21**    | Delegate work to subagents.                                             |
|   **M22**    | Execute autonomous actions.                                             |
|   **M23**    | Steward the knowledge base.                                             |
| **Deferred** | **_Episodic consolidation:_** abstracting experience into knowledge.    |
| **Deferred** | **_Source synchronization:_** keeping knowledge aligned with the world. |

Each milestone is tracked in `.reference/plans/` (plans and evidence), with
completed plans under `.reference/plans/closed/` and their verification under
`.reference/plans/evidence/`.

The intent is for the repository to document the development process rather than simply present the final architecture.

---

## Architecture

At its current stage, ICOS intentionally has a small architecture.

```mermaid
flowchart TD
%%{init: {"layout": "elk"}}%%
User["<b>User / UI</b>"]

Interaction["<b>Interaction Layer</b><br/>commands / approval<br/>clarification"]

Agent["<b>Agent Loop</b><br/>context / decision<br/>tool execution"]

Sessions["<b>Sessions</b><br/>SQLite / FTS5<br/>conversation"]

LLM["<b>LLM Boundary</b><br/>provider-independent"]

Capabilities["<b>Capabilities</b><br/>skills / tools /<br/>external actions"]

Provider["<b>Model Provider</b>"]

Evidence["<b>Evidence / Activity</b><br/>conversation / actions<br/>observations"]

MemCandidates["<b>Memory Candidates</b><br/>evidence / claims<br/>experimental"]

EpistemicMem["<b>Epistemic Memory</b><br/>(M10 → M12)<br/>knowledge / retrieval<br/>revision / evolution"]

User --> Interaction --> Agent

Agent --> Sessions
Agent --> LLM
Agent --> Capabilities

LLM --> Provider

Sessions --> Evidence
Capabilities --> Evidence

Evidence --> MemCandidates
MemCandidates --> EpistemicMem

%% Experimental / planned components
style EpistemicMem stroke-dasharray: 5 5
```

Some components shown above represent planned capabilities rather than fully implemented subsystems. The architecture grows as each milestone provides a reason to introduce the next layer.

---

## Repository Structure

The project is organized around the runtime, the web client, and the
experimental evidence behind each milestone.

```text
core/                   # ICOS runtime (NestJS)
web-client/             # Angular web client
docker-compose.yml      # Supported launch path (core service)
docker-compose-dmr.yml  # DMR override: models served in-stack (see bin/dmr)
bin/dmr                 # Shorthand for the DMR variant
docs/                   # User-facing docs (security, blueprints, sample skills)
.reference/             # Plans, evidence, and planning notes
ARCHITECTURE.md         # Plain-English architecture and feature guide
INDEX.md                # Full repository map
USAGE.md                # Setup, configuration, and operation
```

See **[INDEX.md](INDEX.md)** for the complete annotated map.

As the project grows, this section will be expanded to document significant architectural boundaries and development conventions.

---

## Research Direction

ICOS is ultimately intended to support experiments around agent behaviour and architecture.

Some of the questions motivating future development include:

- Does persistent memory improve behavioural continuity?
- Does explicit epistemic memory reduce recurring errors?
- Does persistent persona remain stable across sessions and model changes?
- Does autonomous action selection produce useful agency?
- Which mechanisms improve capability versus merely increasing complexity?
- Can knowledge be maintained and evolved without requiring an increasingly complicated architecture?
- How much of an agent's behaviour can be explained by a relatively small runtime?

The architecture is therefore a means to an end.

**The interesting part is what changes when the architecture changes.**

---

## Project Status

ICOS is an active personal research and software project.

It is **not production software** and should be considered experimental.

The architecture, APIs, configuration, and milestone definitions may change without maintaining backward compatibility.

The repository's milestone plans and evidence are intended to make those changes visible rather than hiding the experimental nature of the project.

---

## Contributing

ICOS is primarily a personal research project and is not currently seeking additional maintainers.

That said, the project is public and feedback is welcome.

If you experiment with ICOS, find a problem, have a question about an architectural decision, or discover an interesting behavioural result, feel free to share it.

Questions are particularly useful when they challenge an assumption behind the architecture.

---

## License

ICOS is available **free for noncommercial use** under the [PolyForm Noncommercial License 1.0.0](./LICENSE.md).

Commercial use requires a separate license.

See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) for details.

---

## Related Research

ICOS is the continuation of research previously conducted under the ISABEL name.

The v2 work explored increasingly complex biologically inspired cognitive architecture.

ICOS deliberately takes a different methodological approach: **start with a minimal architecture and reintroduce capabilities incrementally.**

The objective is not to build the most elaborate agent architecture possible.

It is to discover **which parts actually matter**.
