# ICOS — Agent Guide

You are contributing to **ICOS** (ISABEL Cognitive Operating System), an
experimental cognitive-agent runtime. This file is the contract for any agent or
human working in this repository: what to build, how to build it, how to prove
it, and what not to touch.

- `README.md` — **what** ICOS is and why it exists.
- `ARCHITECTURE.md` — **how** each part works and whether it is verified.
- This file — **how to work here.**

---

## The contract (non-negotiable)

- **Work on `dev`.** `master` tracks released/stable. Never commit to `master`.
- **Never push.** The maintainer handles remotes. Commit locally and stop.
- **Evidence or it didn't happen.** A milestone is only complete when
  verification evidence — **unit + e2e + a live run** — is committed under
  `.reference/plans/evidence/`. "It works on my machine" is not evidence. Claim
  nothing you cannot point to a test, an evidence file, or a transcript for.
- **Honesty is architectural.** No fake assistant messages, no silent side
  effects, no narrating actions that never executed. Every state change is
  explicit and persisted to SQLite. If something is unverified, say so plainly.
- **`tsc` and `eslint` must be clean before committing.**
- **Provider-agnostic.** Never hard-code a provider. All LLM access goes through
  the OpenAI-compatible interface.
- **Never commit secrets** — credentials, API headers, tokens. `core/.env` is
  local-only and must stay uncommitted (it is gitignored). `core/.env.sample` is
  the authoritative configuration reference.
- **The runtime lives under `core/`.** There are no `apps/*` sub-projects; do
  not reference them.
- **Keep the compose path working.** `docker compose up --build` must launch a
  healthy `core`.

---

## What ICOS is

ICOS is not a wrapper around an existing agent framework. **The runtime is the
harness**: the agent loop, interaction layer, model boundary, sessions, memory,
skills, and tools are one deliberately small system. The design rule is *start
small, add capability deliberately, measure what changed* — if a capability
cannot justify the complexity it adds, it does not belong yet.

It is a personal research system, not production software. Match its tone:
precise, honest, and explicit about limits.

Read before coding:

- `.reference/plans/full-roadmap-extended.md` — the full M1→M40 roadmap.
- `.reference/status.md` — the live status rollup.
- `.reference/notes/release-1.0-exit-criteria.md` — what must be true before
  the v1.0 tag.

---

## Repository map

```text
icos/
├── core/                     # NestJS runtime — the agent itself
│   ├── src/
│   │   ├── conversation/     # the turn loop (converse / converseStream / resume)
│   │   ├── agent/            # bounded plan → act → observe orchestration
│   │   ├── memory/           # candidates, beliefs, recall, dynamics, retrieval
│   │   ├── persona/          # identity layers + drift detection
│   │   ├── tools/            # registry, execution service, invocation ledger
│   │   ├── skills/           # skill catalog + activation
│   │   ├── mcp/              # MCP client, toolsets, resources
│   │   ├── channels/         # Discord + email
│   │   ├── subagents/        # delegation runner (M21)
│   │   ├── session/          # SQLite stores + migrations
│   │   ├── llm/              # provider-agnostic client + wire protocol
│   │   ├── approvals/        # approval-gated execution
│   │   ├── security/         # auth, secret vault, provider catalog
│   │   └── …                 # cron, realtime, vision, image, browser, process
│   ├── test/                 # e2e specs (real HTTP through the app)
│   ├── Dockerfile            # server image used by compose
│   ├── .env.sample           # authoritative runtime configuration reference
│   └── .dmr.env.sample       # Docker Model Runner variant
├── web-client/               # Angular 21 SPA
│   ├── src/app/components/   # Chat, Memory, Skills, Tools, Agents, Cron, … tabs
│   ├── Dockerfile
│   └── AGENTS.md             # Angular/TypeScript rules — read it for client work
├── bin/                      # launch helpers: stack, stack-local, verifier, dmr
├── docs/                     # usage, security, releases, model-lineups, blueprints
├── .reference/
│   ├── plans/                # milestone plans
│   │   ├── closed/           # completed plans
│   │   └── evidence/         # verification evidence (per milestone)
│   ├── notes/                # subsystem design notes
│   └── status.md             # live status rollup
├── docker-compose.yml        # supported launch path (core + web-client)
├── docker-compose-dmr.yml    # + Docker Model Runner override
├── ARCHITECTURE.md           # plain-English feature + verification guide
├── INDEX.md                  # annotated repository map
└── README.md
```

---

## Where files live

- **Runtime data lives in `~/.icos/`** — databases, auth material, the persona
  core, the agent workspace, and the runtime skills copy. Anything the running
  system reads or writes belongs there, not in the repo.
- **`core/skills/` ships** — it is seeded into the runtime on boot. Everything
  under `.reference/` is development material and never ships;
  `.reference/notes/` in particular is local scratch.
- **A planning doc is not a dependency.** If a file exists only for tuning,
  calibration, or planning, no system code and no test may require it — and it
  must never be copied into the shipped tree to satisfy a test. If the system
  genuinely needs the data at runtime, put it in `~/.icos/`; if a test genuinely
  needs fixture data, commit a small fixture under the package that owns it.

---

## Environment

- **Node.js 24.x / npm 11.x.** Core is NestJS 11; the web client is Angular 21;
  both are TypeScript 5.9.
- **Docker + Docker Compose** for the supported run path.
- **A model backend**: a local OpenAI-compatible server (Ollama, llama.cpp,
  Docker Model Runner) or an external endpoint.

**Networking gotcha:** `localhost` *inside a container* is the container itself.
A model server on your host is `host.docker.internal` (macOS/Windows). Never
assume a host-local URL resolves in-container — document the real address.

---

## Build, test, lint

**Core** (`core/`):

```sh
npm install
npm test            # unit tests (jest)        — must be green
npm run test:e2e    # end-to-end tests (HTTP)  — must be green
npx tsc --noEmit    # typecheck                — must be clean
npm run lint        # eslint (with --fix)
npx eslint "src/**/*.ts"   # eslint check only, no fix
```

**Web client** (`web-client/`):

```sh
npm install
npm test            # unit tests (ng test → vitest)
npm run build       # production build
npm run lint        # eslint
```

**Run the stack:**

```sh
docker compose up --build          # core + web client
bin/stack up [--build]             # claims verifier (host) + stack, one command
bin/stack-local up                 # same, but fully offline local DMR models
docker compose down
```

The launch helpers (`bin/stack`, `bin/verifier`, `bin/dmr`, `bin/stack-local`)
are documented in `docs/usage.md`. The web client is served on `:4200`, the core
API on `:3000`.

---

## The development loop

Every change follows the same shape:

1. **Recon from ground truth.** Read the relevant code, plan, and evidence
   before proposing anything. When behaviour is surprising, get facts from the
   ledger, the SQLite database, or the logs — never from a summary (see
   *Debugging from ground truth*).
2. **Plan the slice.** Non-trivial work gets a plan under `.reference/plans/`.
   A milestone states a *question*, a *goal*, and *exit criteria*.
3. **Implement the whole slice.** No thin slices — finish the job before moving
   on. Prefer completing a capability over scattering partial work.
4. **Verify.** Unit tests for the mechanism, an e2e test for the wired path, and
   a **live run** against a real provider/database for the honest claim. Pin
   bugs with a test that fails without the fix and passes with it.
5. **Record evidence.** Write it under `.reference/plans/evidence/` (below).
6. **Commit per slice.** Keep each commit reviewable; use the message style
   below.

---

## Milestones, plans, and evidence

- **Plans** live in `.reference/plans/` (e.g. `milestone-N-*.md`). Open with
  `> Status: **planned** (YYYY-MM-DD)` and state the objective, design, and exit
  criteria.
- **Completed plans** move to `.reference/plans/closed/`.
- **Evidence** lives in `.reference/plans/evidence/` (usually
  `evidence/milestone-N/…-evidence.md`) and opens with
  `> Status: **verified** (YYYY-MM-DD)`. It records what was built, the unit and
  e2e results, the **live run** and its exact outcome, and the honest remainder
  (what was *not* verified and why). UI claims include a screenshot.
- The roadmap (`.reference/plans/full-roadmap-extended.md`) is checked off
  **only** when evidence backs the item.

---

## Commits

- One logical slice per commit. Message style is `type(scope): summary` in the
  imperative, lowercase:

  ```text
  feat(subagents): M21.3 hardening (fan-out, parked resume, docs)
  fix(streaming): rotate request id on validation-failure recovery
  docs(m21.2): subagent integration live evidence (verified)
  ```

- Common types: `feat`, `fix`, `docs`, `update`, `refactor`, `test`, `chore`.
- Do not commit generated artifacts, `node_modules`, `dist`, `.env`, or local
  scratch files.

---

## Adding a capability

- **A tool** — follow `docs/tool-blueprint.md` exactly. Tools are code, not
  config: the catalog is a frozen array and every tool flows through five
  touchpoints (registry, wire aliases, execution service, repository, turn
  loop). Respect the hard limits it lists (one tool call per step, five steps
  per turn, 64 KB serialized results).
- **A skill** — follow `docs/skill-blueprint.md`. Skills are markdown with YAML
  front-matter, discovered from the skills catalog.
- **A milestone** — add the goal to the roadmap, write the plan, implement,
  verify, commit evidence, move the plan to `closed/`, then check off the
  roadmap.

---

## Configuration and secrets

- `core/.env.sample` is the authoritative, commented reference for every runtime
  variable. **Update it whenever you add configuration.**
- `core/.env` is local-only and gitignored. `.env` changes require
  `docker compose up -d` — a plain `docker compose restart` does not re-read the
  file.
- Provider keys and MCP secrets go through the encrypted secret vault (references
  such as `secret:NAME`), never literals. See `docs/security.md`.
- The provider catalog (`~/.icos/providers.json`) can select the active provider
  at runtime; the `LLM_*` env values are the fallback.

---

## Hard-won pitfalls

- **One tool call per response.** Fan-out fails closed (`invalid_call_count`);
  multi-step work chains across turns, not within one. Identical re-issues are
  refused (`repeated_call`) — a few read tools (e.g. `delegate_status`) are
  deliberately exempt because polling is repeat-shaped.
- **The invocation ledger is the system of record.** Execution is exactly-once;
  resume observes the ledger row and never re-executes.
- **Fail closed on malformed provider output.** A structurally invalid
  completion is a 502, not a guess.
- **Streaming and non-streaming paths differ.** A bug can hide in one only — the
  `request_conflict` incident lived in `converseStream` while the non-streaming
  `converse` was immune. Test both.
- **`.reference/notes/` is mid-reorganisation.** Some specs read notes files by
  path; confirm the suite is green on `HEAD` before blaming your change.

---

## Debugging from ground truth

- **Sessions database:** `~/.icos/data/sessions.db` (SQLite). Key tables:
  `sessions`, `messages`, `agent_runs`, `tool_requests` (the invocation ledger),
  `delegations`, `approvals`. Query it read-only (e.g. with `better-sqlite3`) to
  reconstruct the actual sequence of events.
- **Logs:** `docker compose logs core` — structured and greppable.
- **Health:** `GET /core/health/live`.
- **Web client auth quirk:** login over plain HTTP only persists on hostname
  `localhost` (Secure cookies). `127.0.0.1` silently drops the session.

---

## Scope boundaries

- Do not touch the maintainer's work-in-progress: `lines.md`,
  `.reference/papers/`, `.reference/rounding-testing/` scratch, and any
  uncommitted `docs/` or `.reference/notes/` reorganisation.
- Public naming is **ICOS** only. Do not introduce other project names as
  architecture components.
- Deleting a session clears its transcript but keeps memory *derived* from it —
  that is deliberate.
