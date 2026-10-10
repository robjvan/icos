# How ICOS Works — An Architecture Report

_A plain-English map of what ICOS does, how each part works, whether it's been
verified, and why it matters. No hand-waving._

> **What this is.** Most projects describe themselves with confident adjectives
> and vague diagrams. This report does the opposite: it says what is built,
> how it works, and how we know it works. Where something is partial or not
> built, it says so.
>
> **Snapshot:** through milestone **M20** (2026-10-10). The M15.5 full-platform
> "roundup" pass lives at
> `.reference/plans/evidence/roundup-testing/roundup-m15.5-evidence.md`; M16–M20
> evidence is under `.reference/plans/evidence/`.

---

## How to read the status labels

Every feature below carries one of these:

| Label                | Means                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Built & verified** | It exists and was exercised by committed tests and/or a live run. |
| **Built (advisory)** | It works, but it informs a human rather than making a decision.   |
| **Partial**          | It works, but weaker than you'd guess — the report says how.      |
| **Not built**        | Planned or imagined; genuinely not in the software yet.           |

"Verified" is a specific claim here. It means one or more of: a **unit test**
(a small, deterministic check of one piece), an **end-to-end test** (the whole
running program driven through a real HTTP request), or a **live run** (the
real software talking to a real model or the real database). It does **not**
mean "we feel good about it."

A useful honesty note up front: our automated tests mostly use a _stand-in_
model instead of a real one, so they prove the machinery is wired correctly —
not that a particular AI model behaves well. Where a real model was used, the
report says so.

---

## 1. What ICOS is

ICOS (**I**SABEL **C**ognitive **O**perating **S**ystem) is a **from-scratch
runtime for an AI agent that can remember things reliably.**

It is not a wrapper around an existing agent framework, and it is not a
chatbot product. It is a small, deliberately-built system that investigates one
research question:

> **How can we engineer artificial cognitive systems that are useful,
> epistemically accountable, and honest about the limits of their own
> knowledge?**

The design philosophy is "start small and add capability deliberately." Every
capability has to justify the complexity it adds, and every milestone has a
written question, an implementation, and committed evidence. Transparency and
honesty are related but distinct: making the internals inspectable does not, by
itself, make the conclusions correct — so ICOS also works on mechanisms for
tracing evidence, representing uncertainty, reviewing memory, and examining
failures. This is a research direction, not a solved problem.

**Status: Built & verified** through M20 (the conversation loop, the memory and
persona layers, external channels, a broad tool surface, dynamic MCP toolsets,
and a full web client are all implemented; see the milestone evidence under
`.reference/plans/evidence/`).

---

## 2. The whole system at a glance

You can think of ICOS as five stacked layers. Read it top to bottom: each
layer uses the one below it.

```text
  YOU
  web client (browser)  ──or──  raw HTTP API
        │
        ▼
  TALKING            conversation loop · streaming · sessions (history + search)
        │
        ▼
  THINKING           one model call at a time, through a single model boundary
        │            (any OpenAI-compatible model: local or cloud)
        │
        ▼
  REMEMBERING        knowledge pipeline:
        │               conversation → candidate facts → evidence ledger
        │               → beliefs ("claims") → promotion (human-approved)
        │               → recall back into the next conversation
        │
        ▼
  REACHING OUT       external channels (Discord, email) · MCP tool servers
        │            a broad tool surface · a skill library · a web client
        │
        ▼
  STAYING HONEST     persona (who it is) · drift detection (is it changing?)
                     hallucination checks (is it making things up?) · safety
```

Each layer is described in its own section below.

**Status: Built & verified.** All layers exist. The live system boots in
Docker and reports itself healthy; the web client and the API both work.

---

## 3. What happens when you send a message

This is the most important thing to understand, because everything else hangs
off it. One message goes through these steps:

1. **You send text.** The web client posts it to the runtime (or streams it,
   see §4).
2. **The runtime loads the context.** It pulls recent conversation history and
   relevant long-term knowledge, and assembles them into a single request for
   the model.
3. **The model responds.** ICOS sends one request to whatever model you
   configured — a local model or a cloud one — and gets text (or a request to
   use a tool) back.
4. **The reply is saved.** The turn is written to a durable session store
   (it survives restarts).
5. **In the background, quietly, the runtime learns.** A separate, non-
   blocking step reads the turn and proposes _memory candidates_ — things that
   might be worth remembering. This never delays or breaks your reply.
6. **Optional checks run.** If configured, honesty checks review the model's
   own claims (see §9).

The key design decision in step 5: **learning never blocks talking.** If the
memory step fails or is slow, your conversation is unaffected.

**Status: Built & verified.** End-to-end tests drive a full turn; the live
system streams real replies.

---

## 4. Talking to it

| Feature              | What it does                                    | How it works                                                                                                                    | Why it's useful                                                    |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Conversation API** | Accepts messages, returns replies.              | A REST endpoint (`POST /core/conversation`).                                                                                    | The basic interface; anything can talk to it.                      |
| **Streaming**        | Shows the reply word-by-word as it's generated. | Server-Sent Events (`POST /core/conversation/stream`); the client renders tokens live and only saves history on a clean finish. | Feels responsive; a dropped connection doesn't corrupt history.    |
| **Sessions**         | Remembers what was said, across restarts.       | A SQLite database of sessions and messages, with full-text search.                                                              | You can close the browser and come back; you can search your past. |
| **Slash commands**   | Shortcuts like `/status`, `/new`, `/export`.    | Handled directly by the runtime, bypassing the model.                                                                           | Instant, deterministic; they never get "interpreted" by the AI.    |

**Status: Built & verified** (unit + end-to-end tests cover the routes; live
probes return the expected results).

---

## 5. Turning conversation into knowledge

This is the heart of ICOS, and the part most projects fake. ICOS separates
**what was said** from **what it believes**, and keeps the receipts.

The pipeline, in plain terms:

1. **Candidate.** After a turn, the runtime asks the model (a smaller,
   separate "extraction" model role) to pull out possible facts — e.g.
   _"the user prefers oak."_ These are only **candidates** at this point.
2. **Evidence ledger.** Every candidate is filed in a ledger with where it came
   from, which message, and how confident the extractor was. This is the
   paper trail.
3. **Belief ("claim").** A candidate can become a belief, which is a
   normalized statement — _subject · predicate · object_ — with a confidence
   and a status (candidate, active, contradicted, retired).
4. **Promotion.** Beliefs don't appear by magic. They are **promoted** through
   a journal that records each proposal exactly once (so a crash can't
   double-apply it), and — by default — a **human approves** the promotion.
5. **Contradiction & reinforcement.** If a new statement clashes with an old
   belief, ICOS doesn't silently overwrite. It keeps both, marks the loser
   **contradicted** (still searchable), and can _park a question_ for you to
   resolve. Agreement instead reinforces the existing belief.

The important word is **provenance**: ICOS can always answer _"why do you
believe that?"_ by pointing at the evidence.

**Status: Built & verified.** Unit tests cover the claim model, contradiction,
and promotion; the live API returns real beliefs and a durable history.

---

## 6. Using knowledge — recall

Storing knowledge is only half the job; the other half is surfacing the right
bit at the right moment.

When you send a message, ICOS retrieves relevant beliefs and folds them into
the model's context. It combines several lenses:

- **Keyword (lexical) search** — finds exact terms.
- **Semantic search** — finds related meaning (via embeddings).
- **Associative recall** — follows links between related beliefs.

Results are **ranked**, gated by a confidence threshold, and — critically —
placed in a **separate, clearly-labelled band** of the prompt so the model
never confuses _"the user told me"_ with _"I remembered."_

**Status: Built & verified.** Recall, ranking, and context assembly are
unit-tested; the live `/core/recall/trace` endpoint exposes what was recalled.
**Partial:** recall quality depends on the model and embedding quality and is
measured, not guaranteed.

---

## 7. Letting knowledge change over time

Real memory isn't a filing cabinet; it's a living thing. ICOS models that
explicitly, and — unlike most systems — **honestly**:

| Behaviour               | What it means in plain terms                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reinforcement**       | Repeated or supported beliefs get more confident (bounded, so it can't run away).                                                                                 |
| **Decay**               | Unused beliefs lose confidence gradually.                                                                                                                         |
| **Revision**            | A belief can be updated, and the change is recorded as history — you can walk back through it.                                                                    |
| **Retirement**          | A belief can be deliberately set aside (not deleted).                                                                                                             |
| **Salience ≠ truth**    | How _prominent_ a belief is (its "activation") is tracked separately from whether it's _true_ (its confidence). A vivid belief isn't automatically a correct one. |
| **Temporal navigation** | Beliefs carry time, so you can ask what was known when.                                                                                                           |

Every change is written to a history journal, so nothing about the knowledge
base changes behind your back.

**Status: Built & verified** (unit-tested; the shapes are deliberate and
documented in the M12 evidence files).

---

## 8. Who it is — the persona

ICOS has a stable identity, kept in **two deliberately separated layers**:

- An **immutable core**: a human-authored file that defines the agent's
  ethical grounding, core beliefs, safety boundaries, and character. The
  software has **no write path** to it — it literally cannot edit its own
  core. At boot, the runtime hashes the file and, by default, **refuses to
  start** if the core is missing or invalid (running without a reference frame
  is worse than not running).
- An **evolving layer**: the parts of identity, user model, and relationship
  that _do_ change over time — but only through a **human review** step, never
  silently.

The core is also injected into the conversation as a "grounding band" so the
agent's stated values are actually in front of the model.

**Status: Built & verified.** Unit and end-to-end tests cover the read-only
core, fail-closed boot, seeding, grounding, candidate review, and the rule
that the evolving layer can never contradict the core. **Partial / Not
built:** the core is read-only but not yet _cryptographically signed_ — a
future hardening plan (`core-provenance-integrity.md`) would make it
tamper-_authenticated_, not just tamper-_evident_.

---

## 9. Staying honest — drift and hallucination

Two mechanisms guard against the agent quietly going wrong.

**Drift detection — "am I still me?"** ICOS watches for signs that the agent
is drifting from its identity or its knowledge: contradictions with the core,
staleness, repeated pressure, low grounding, and a semantic/embedding signal.
Findings are reconciled and surfaced on a reporting endpoint.

> **Status: Built (advisory).** The structural checks are deterministic. The
> semantic (embedding) signal is deliberately labelled **advisory**, because
> on our corpus it tracks topic and tone more than a change in commitment
> (measured F1 0.78). We report it honestly rather than overselling it.
> Further tuning is a documented backlog item.

**Hallucination checks — "am I making this up?"** When the model asserts
something, ICOS can check it against its own beliefs:

1. **Deterministic check (no model needed).** Is the claim backed by an active
   belief (`supported`), contradicted by one (`contradicted`), or genuinely new
   (`novel`)? It also catches a claim that cites evidence which doesn't exist.
2. **Optional second opinion.** For high-stakes claims, a _different_ model
   can be asked to weigh in. ICOS supports a specialist local "decision" model
   (Jev-style) first, then a general chat model, then nothing. If the second
   opinion disagrees, the disagreement is **recorded, never silently
   resolved**.
3. **Explicit mitigation.** The result becomes one of: **flag**, **re-ground**
   (look it up and re-answer), **defer** (ask a human), or **refuse** — and
   every action is written to an append-only ledger. There is **never a silent
   rewrite.** If no verifier is configured, the system still works on the
   deterministic checks alone.

**Status: Built & verified.** The full pipeline is unit-tested and was
**verified end-to-end against a real local Jev 2B decision model**: a real
turn whose claim contradicted a stored belief was caught, refused, and logged,
with the verifier tier recorded. **Not built:** _blocking_ pre-send mitigation
(today the audit runs after the turn, so it never adds latency).

---

## 10. Getting things done — skills, tools, and the agent loop

| Feature                        | What it does                                      | How it works                                                                                                                                                                                | Why it's useful                                    |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Skills**                     | Reusable instruction packs the agent can pull in. | Markdown files (`SKILL.md`) discovered from a folder, validated fail-closed, and injected into context when relevant (by keyword, no magic).                                                | Teach the agent a procedure without retraining it. |
| **Tools**                      | Real actions the model can request.               | A registry with concrete tools (e.g. `session.search`, `session.rename`) plus tools bridged in from external systems. The model _proposes_ a call; the runtime decides whether to allow it. | Lets the agent _do_ things, not just talk.         |
| **The agent loop**             | Multi-step "plan → act → observe → continue".     | A bounded loop with execution and time budgets, loop/repetition protection, and failure recovery.                                                                                           | Handles tasks that need several steps.             |
| **Approvals & clarifications** | Human checkpoints.                                | Structured requests with explicit states (`pending → approved / rejected / expired / cancelled`). **Model text can never approve anything.**                                                | Keeps a human in control of consequential actions. |

**Status: Built & verified.** Skills, tools, the loop, and approvals all have
unit and end-to-end coverage. There are 26 native tools plus everything MCP
servers contribute; to keep each request small, ICOS injects only a bounded,
relevant subset per turn — a small always-on core plus tools discovered from
the message, with a `search_platform_tools` meta-tool and `/tools pull` to
reach the rest. Discovery only narrows what the model is _shown_, never what
the operator allows, and calls still approve normally.

---

## 11. Talking to other systems

- **MCP (Model Context Protocol).** ICOS acts as a _client_ to standard MCP
  servers: their tools are bridged into the agent loop and their resources and
  prompt templates are exposed read-only. Servers can be added/removed and the
  catalog reloaded **without a restart**, and each server reports its health.
  Spawned servers get a **minimal environment** — only the variables they
  explicitly reference — so they can't read your other secrets.
- **External channels (M16).** Discord and email are first-class: inbound
  messages become turns, outbound sends are approval-gated, and Discord
  registers native slash commands. Sending is a normal tool (`channel.send`)
  with its own allowlists.
- **Providers (the model boundary).** ICOS never hard-codes a model vendor.
  Everything speaks the OpenAI-compatible interface, and a runtime **provider
  registry** lets you add providers and choose which model serves which role
  (chat vs. memory extraction vs. verification), with keys held as references.

**Status: Built & verified** (routes present, unit + end-to-end covered; the
MCP path was additionally exercised against a real external server in M13).
**Partial:** the DMR (Docker Model Runner) convenience path is still marked
"in testing."

---

## 12. Running and managing it

- **Web client (M20).** An Angular app with real management surfaces: chat
  (streaming), **Memory** (review queue, beliefs, ledger, and a **Context**
  segment showing the token budget and the rolling summary), **Skills**
  (view / edit / delete), **Tools** (inventory + global auto-approve +
  discovery state), **Cron**, the **identity/persona** tab, **MCP** servers,
  **Models** (providers), **Server settings** (secrets + security posture),
  and **Client settings** (theme, health poll, and the global context target).
  The remaining tabs — agents, files, knowledge-base, sensors, metrics, and
  comms — are honest placeholders that render a visible **"server
  unimplemented"** marker (with a milestone pointer) instead of fake data.
- **Security.** Loopback-only by default; authentication on by default with a
  bootstrap token; signed sessions with CSRF protection; an **encrypted
  secret vault** (AES-256-GCM, write-only — values are never returned by any
  API); exact CORS origins (no wildcards); and loud boot warnings if you expose
  it without TLS.
- **Deployment.** The supported path is **Docker Compose**: one command brings
  up the runtime and the web client, both health-checked, with data in a
  single mounted folder so it survives rebuilds.

**Status: Built & verified.** The full stack builds and boots **healthy** in
Docker; the live security posture was probed (unknown origins rejected, vault
write-only, secrets `no-store`).

---

## 13. How we know it works — the evidence habit

ICOS is built so that _claims are checkable_. Every milestone leaves:

- a **plan** stating the question and what "done" means;
- **evidence** — the actual test results, counts, and live-run observations;
- **committed code** that passes a clean type-check and linter.

At this snapshot the numbers are:

| Check                    | Result                                             |
| ------------------------ | -------------------------------------------------- |
| Runtime unit tests       | **1234 passing** (+1 optional live test)           |
| Runtime end-to-end tests | **68 passing**                                     |
| Web-client tests         | **200 passing**                                    |
| Runtime coverage         | functions **81.3%**, lines **80.5%**               |
| Type-check / lint        | clean (both packages)                              |
| Docker stack             | core + web client **healthy**                      |
| Live model check         | hallucination verifier answered a real local model |

This report itself is the product of that habit: the M15.5 full-platform
**roundup** re-checked every claim in these docs against the running system, and
the M20 pass brought the test counts and the milestone status current again.

---

## 14. Honest status at a glance

| Capability                                            | Status                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Conversation, streaming, sessions                     | Built & verified                                           |
| Memory extraction → evidence → beliefs → promotion    | Built & verified                                           |
| Recall, ranking, context bands                        | Built & verified                                           |
| Memory dynamics (reinforce / decay / revise / retire) | Built & verified                                           |
| Persona (immutable core + reviewed evolving layer)    | Built & verified                                           |
| Drift detection                                       | Built (advisory semantic signal; structural deterministic) |
| Hallucination mitigation                              | Built & verified (audit is post-turn, not blocking)        |
| Skills, tools, agent loop, approvals                  | Built & verified                                           |
| Dynamic MCP toolsets                                  | Built & verified (M19)                                     |
| External channels (Discord, email)                    | Built & verified (M16); SMS not built                      |
| Web client (management surfaces)                      | Built & verified (M20); a few tabs remain placeholders     |
| Context budget + automatic compaction                 | Built & verified (M20.6)                                   |
| Per-turn tool discovery                               | Built & verified (M20.7)                                   |
| MCP client, provider registry                         | Built & verified (DMR path still "in testing")             |
| Security (auth, vault, CORS, posture)                 | Built & verified                                           |
| Docker launch path                                    | Built & verified                                           |
| Core signing / tamper-authentication                  | **Not built** (future hardening)                           |
| Subagents                                             | **Not built** (M21)                                        |
| Autonomous action selection                           | **Not built** (M22)                                        |
| Sensors, reactionary events                           | **Not built** (M24–M25)                                    |

---

## 15. What ICOS is _not_

Being clear about this is part of being honest:

- **Not production software.** It is an active research platform; interfaces
  and internals may change without warning.
- **Not a general-purpose agent framework.** It is built to ask specific
  questions about agent architecture, not to compete on features.
- **Not omniscient or infallible.** The honesty checks _detect and surface_
  problems; they are not a guarantee of truth, and the "second opinion" is an
  input, never an authority.
- **Not tamper-proof.** The persona core is read-only to the software, but if
  you control the machine _and_ the program, no client-side check can stop you.
  The achievable guarantee is _honest-by-default and tamper-evident_.
- **Not self-modifying.** Nothing in the running system rewrites its own code,
  its core identity, or your visible output behind the scenes.

---

## 16. Glossary (plain English)

- **Agent loop** — the cycle of the model deciding an action, the runtime
  performing it, and feeding the result back until the task ends.
- **Claim / belief** — one normalized statement the agent holds, with a
  confidence and a status.
- **Evidence ledger** — the paper trail connecting a belief back to the exact
  conversation moment it came from.
- **Embedding** — a numeric fingerprint of text, used to find things that
  _mean_ the same thing without sharing words.
- **MCP** — an open protocol for plugging external tool servers into an agent.
- **Promotion** — the controlled step that turns a proposed fact into an
  accepted belief (human-approved by default).
- **Provenance** — the recorded origin of a belief; "where did this come from?"
- **Provider** — the source of the AI model (local or cloud), reached through
  one common interface.
- **Streaming** — showing a reply as it's produced, token by token.
- **Verifier** — an optional second model used to double-check a claim.

---

_ICOS is an experimental project built to the author's requirements, not to a
market. If a capability can't justify its complexity, it isn't in the
architecture yet — and this report will say so._
