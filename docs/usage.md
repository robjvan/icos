# ICOS — Usage Guide

How to configure, run, and operate ICOS. For what the project *is* and
*why* it is built this way, see the [README](../README.md).

- [Deployment target](#deployment-target)
- [Security first](#security-first)
- [Requirements](#requirements)
- [Install](#install)
- [Configure](#configure)
- [Authentication and secrets](#authentication-and-secrets)
- [Run the stack](#run-the-stack)
- [Using the web client](#using-the-web-client)
- [Deliberate behaviours](#deliberate-behaviours)
- [Tool discovery](#tool-discovery)
- [Where data lives](#where-data-lives)
- [Exposing ICOS](#exposing-icos)
- [Troubleshooting](#troubleshooting)
- [Documentation map](#documentation-map)

---

## Deployment target

The supported deployment target is a **Docker container**, defined by
`docker-compose.yml` and `core/Dockerfile`. Docker Compose brings up Core
plus the Angular web client.

Bare-metal (`npm run start` + the web client dev server) remains available
for local development, but Docker is the expected way to launch and play
with the stack.

---

## Security first

ICOS binds to `127.0.0.1` and publishes only to loopback by default, and it
requires a **login**. Session cookies are `Secure`, so they need HTTPS.

> **Do not expose ICOS beyond your machine until TLS and authentication are
> in front of it.** For a personal instance, a VPN (WireGuard/Tailscale) or a
> TLS reverse proxy is the least-effort safe option.

Full details, including a copy-paste Caddy example and a pre-exposure
checklist: **[security.md](security.md)**.

---

## Requirements

- **Docker** with **Docker Compose** — the supported way to run the stack.
  Give Docker **at least 4 GB of memory** (Docker Desktop → Settings →
  Resources). The web-client image compiles the Angular app during
  `docker compose build`, which needs ~1.5 GB; on a 2 GB Docker host the
  build fails with esbuild `JS heap out of memory` errors.
- **8 GB VRAM minimum** if you serve models through the Docker Model Runner
  (memory and chat models share one GPU budget; below this the runner
  evicts or degrades models).
- **Node.js 24.x** and **npm 11.x** (tested on Node 24.21.0 / npm 11.19.0) —
  only needed for local development
  outside Docker.
- An OpenAI-compatible LLM endpoint (local or remote). The model does not
  need to run on the same machine.

> **Which models?** ICOS is provider-agnostic. For the roles, two sensible
> lineups, and the memory budget, see [model-lineups.md](model-lineups.md).

---

## Install

```sh
git clone https://github.com/robjvan/icos.git
cd icos
```

No `npm install` is needed for the Docker path — the image build handles
dependencies.

---

## Configure

ICOS is configured through environment variables. Create a local env file
from the example:

```sh
cp core/.env.sample core/.env
```

Then edit `core/.env`. A minimal example:

```env
# LLM
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=<your-model>

# Application
PORT=3000
```

**`core/.env.sample` is the authoritative configuration reference** — it
documents every variable and default. The exact set may change as
development continues.

> **Never commit `core/.env`.** It is local configuration and may hold
> credentials. The file is git-ignored; `core/.env.sample` is the shareable
> template.

> **Docker networking note:** inside the container, `localhost` refers to the
> container itself, not your machine. If your LLM runs on the Docker host
> (e.g. host Ollama), point `LLM_BASE_URL` at
> `http://host.docker.internal:<port>/v1` or your host's LAN address. Remote
> provider URLs work unchanged.

### Providing keys

Keys can come from the environment, or from the encrypted vault (see below).
Catalogs and env files hold **references**, never literals:

- `$VAR` / `${VAR}` → a process environment variable.
- `secret:NAME` → a vault secret.

`core/.env.sample` documents where each applies (MCP server `env`/`headers`,
LLM provider `apiKeyRef`/`headers`).

---

## Authentication and secrets

### Log in

On first boot ICOS generates a **bootstrap token** at
`<AUTH_DIR_PATH>/token` (default `~/.icos/auth/token`, mode `0600`) and logs
the **path** only — never the value. Read it and use it to sign in:

- In the web client: the login screen asks for it.
- From the shell:

  ```sh
  curl -s -c /tmp/icos.cookies -X POST http://127.0.0.1:3000/core/auth/login \
    -H 'content-type: application/json' \
    -d "{\"token\":\"$(cat ~/.icos/auth/token)\"}"
  ```

  Mutating requests must also echo the `icos_csrf` cookie in the `x-icos-csrf`
  header. `GET /core/auth/session` reports login state; `POST
  /core/auth/logout` clears it. Failed logins are rate-limited per IP, and
  security events are appended to `<AUTH_DIR_PATH>/audit.log` (never values).

### Enable the secret vault (optional)

To store API keys from the web client (encrypted at rest), generate a
32-byte master key once and point ICOS at it:

```sh
head -c 32 /dev/urandom | base64 > ~/.icos/auth/vault.key
chmod 600 ~/.icos/auth/vault.key
```

Then set it in `core/.env`:

```env
VAULT_KEY_FILE=/Users/<you>/.icos/auth/vault.key
```

Restart the stack. The **Server settings** tab then becomes writable: values
you enter are encrypted (AES-256-GCM) at rest and are **never** returned by
any API — the UI shows presence and timestamps only.

> **Back up the master key separately.** The vault file is useless without it,
> and a lost key means re-entering every secret. With no key configured the
> vault is disabled and `$VAR` environment references still work.

> **Docker users:** keep `AUTH_DIR_PATH` (and therefore the vault, token, and
> audit log) under the bind-mounted data root, e.g.
> `AUTH_DIR_PATH=/Users/<you>/.icos/auth`, or the files land inside the
> container and vanish on rebuild.

---

## Run the stack

### Docker with the Docker Model Runner (recommended first run)

One command, zero sidecars: the Docker Model Runner serves the memory model
(and, eventually, the chat model) inside the compose stack — no Ollama
daemon, no separate downloads.

```sh
docker compose -f docker-compose.yml -f docker-compose-dmr.yml up --build -d
# shorthand:
bin/dmr up -d --build
```

Once `core` is healthy, open **http://localhost:4200** (or
`http://<host>:4200` from another machine you have deliberately exposed it
to). Give the stack a minute after first boot: models download once (GBs) and
the vector index rebuilds before recall is at full strength.

Stop with `bin/dmr down` (or the explicit `-f … -f … down`). The two variants
bind the same host ports, so bring one down before starting the other.

> **DMR status: in testing.** The compose file, model refs, and VRAM behaviour
> are still being validated. It works; treat sharp edges as expected.

### Docker with your own models

If you already run Ollama, llama.cpp, or a remote provider:

```sh
docker compose up --build -d
```

Configure `LLM_*` / `MEMORY_*` in `core/.env` (see [Configure](#configure)).

### The claims verifier (optional)

The hallucination check prefers a **decision model** — a local Jev-style
server answering `POST /v1/systemone` — and falls back to a generic LLM
verifier, then to the deterministic claim/evidence checks. It is
**optional**: with none configured, ICOS still runs, just without the second
opinion.

Docker on macOS cannot reach Apple's GPU, so the verifier runs on the
**host** (MLX), not in a container. `bin/verifier` bootstraps its runtime
once, then serves the 2B model on `127.0.0.1:8765`:

```sh
bin/verifier                          # serve :8765 (installs the runtime once)
JEV_STYLE_RELEASE=0.8b bin/verifier   # smaller / faster model
```

Core (in Docker) reaches it at `host.docker.internal:8765`, which is what
`core/.env` already sets for `HALLUCINATION_DECISION_URL`. On Linux, either
point `HALLUCINATION_VERIFIER_PROVIDER` at a model you already run, or leave
both unset and let the deterministic checks carry the load.

#### Running it alongside the stack

The verifier is a **foreground host process**; the stack runs **detached in
Docker**. They are independent — the verifier serves the decision model on
the host, the stack serves the memory model (DMR) plus everything else — so
there is nothing to chain: start the verifier in one terminal, then bring up
the stack in another.

```sh
# terminal 1 — the decision model (leave it running)
bin/verifier

# terminal 2 — the stack (detached, so this returns)
bin/dmr up -d --build          # DMR memory model
# or: docker compose up -d --build
```

To keep it to one shell, background the verifier first:

```sh
bin/verifier > ~/.icos/verifier.log 2>&1 &
bin/dmr up -d --build
```

It is the **same verifier for both stack variants** — it does not care
whether the memory model comes from the DMR or your own Ollama. The one
difference is configuration:

> **DMR variant note.** `core/.dmr.env` (the DMR env file) is a trimmed
> mirror of `core/.env` and does **not** set `HALLUCINATION_DECISION_URL`, so
> the DMR path has no decision verifier until you add it. To match the
> standard path, put `HALLUCINATION_DECISION_URL=http://host.docker.internal:8765`
> in `core/.dmr.env`.

The verifier is bursty and latency-tolerant: on a discrete GPU, run it
CPU-side so it never competes with the memory model for VRAM. See
[model-lineups.md](model-lineups.md) for the backends and the memory budget.

### Bare metal (local development)

```sh
cd core
npm install
npm run start          # Core on :3000
```

and, in a second terminal, the web client:

```sh
cd web-client
npm install
npm start               # Angular dev server on :4200
```

### Development mode

Core with automatic reload:

```sh
cd core
npm run start:dev
```

Run the test suites:

```sh
cd core && npm test                  # unit
cd core && npm run test:e2e          # e2e
cd web-client && npm test            # web client
```

> Available scripts may change as the project develops. Run `npm run` in
> either package to see the current commands.

---

## Using the web client

Open `http://localhost:4200`, sign in with the bootstrap token, and you land
on the **chat dashboard**. The client (`web-client/`, `:4200`) fronts the core
REST API, and its tabs are honest about what exists: live surfaces render real
data, and anything not yet built renders a visible **"server unimplemented"**
marker (with a milestone pointer) instead of fake data.

Live surfaces: **Chat**, **Memory** (review queue, beliefs, ledger, and a
**Context** segment), **Skills**, **Tools**, **Cron**, **Identity**,
**MCP**, **Models**, **Server settings**, and **Client settings**. Still
placeholders: **Agents**, **Files**, **KB**, **Sensors**, **Metrics**, and
**Comms**.

The security work added three management surfaces (admin-only):

- **MCP** tab — add, edit, enable/disable, and remove Model Context Protocol
  servers; reload the catalog without a restart. Server state (connected /
  disabled / failed, with a reason and tool count) is shown live. Enter
  secret references (`$VAR` or `secret:NAME`), never values.
- **Models** tab — manage LLM providers: add/edit/remove, choose the active
  provider for the **conversation** and **memory** roles, and **Test** a
  provider's connection. Key presence is shown; the key itself is never
  displayed.
- **Server settings** tab — store/rotate/delete vault secrets (write-only,
  masked), and see the exposure posture. A red banner appears when the
  instance is bound beyond loopback and unacknowledged.

**Client settings** holds browser-local preferences (theme, health-poll
interval) plus the global **context compaction target**. **Memory → Context**
shows the resolved token budget and the rolling summary for a session.

A session that expires mid-use sends you back to the login screen
automatically.

---

## Deliberate behaviours

Some behaviours are intentional and would otherwise look like bugs. This
section records them.

### Deleting a session

In the **Chat** tab, an open session has a **Delete** button beside **New**.
It asks for confirmation, then removes the session and its transcript.

Two things are deliberate:

- **You must open a session to delete it.** There is no hover-to-delete on the
  session list. That friction is intentional: deleting the session you are
  looking at is how you delete the one you mean, without inviting accidental
  deletions from the sidebar.
- **Memory survives.** Candidates, beliefs, promotions, and source evidence
  *derived* from a session are **not** deleted with it. Deleting a session
  clears the transcript, not what ICOS learned from it. This makes it harder to
  erase usage patterns or behaviour by wiping old sessions — and means clearing
  out old conversations will **not** remove facts you actually want gone.

To remove derived memory, do it explicitly under the **Memory** tab (review /
beliefs / ledger), where each item is deleted on its own terms.

---

## Tool discovery

ICOS keeps the full tool catalog in memory but does **not** send every schema
on every turn. Each turn injects a bounded, relevant set:

- a small **always-on core** (`TOOLS_ALWAYS_ON`, default
  `search_platform_tools,memory,todo`), plus
- tools **discovered** deterministically from your message, capped at
  `TOOLS_MAX_PER_TURN` (default 12; discovery limit `TOOLS_DISCOVERY_LIMIT`,
  default 8).

**Discoverability is not authorization.** Discovery only changes what the model
is *shown*. It can never surface a tool the operator disabled, never widen the
enabled set, and never bypass approvals — every call still runs through the
normal validation and approval path. A discovered tool is, by construction,
already enabled by your configuration (`TOOLS_ENABLED*` / `TOOLS_DISABLED*`).

### Pulling a tool on demand

If the model needs a tool that was not offered, it can call the always-on
`search_platform_tools` meta-tool; the matching schemas are injected on its next
step (bounded by `TOOLS_PULL_MAX_RESULTS` / `TOOLS_PULL_MAX_PER_TURN`). You can
do the same explicitly:

- `/tools pull <query>` — stage matching tools for the next turn;
- `/tools list` — every policy-enabled tool;
- `/tools status` — the discovery state and bounds;
- `/tools clear` — drop staged pulls for the session.

Pulls are **one-shot** for the next turn — ICOS does not accumulate discovered
schemas indefinitely.

### Turning it off

Set `TOOLS_DISCOVERY_ENABLED=false` to inject every policy-enabled tool on every
turn (the pre-M20.7 behaviour). The Tools tab shows the resolved discovery state
and bounds; `/tools status` reports the same.

---

## Where data lives

Everything persists under a single data root (default `~/.icos`), which the
compose file bind-mounts so it survives container rebuilds:

- `~/.icos/data/` — session and memory SQLite databases, the claim vector
  index.
- `~/.icos/auth/` — bootstrap token, session key, audit log, and the secret
  vault.
- `~/.icos/skills/` — filesystem skills.
- `~/.icos/mcp-servers.json` — the MCP server catalog (also editable from the
  UI).
- `~/.icos/providers.json` — the LLM provider catalog (also editable from the
  UI).
- `~/.icos/context-settings.json` — the runtime context-compaction override
  (target / enabled), written by the Client settings tab.
- `~/.icos/models/` — embedding-model cache.

Exact paths come from `core/.env`; see `core/.env.sample`.

---

## Exposing ICOS

Default is loopback-only. To expose it deliberately:

1. Put **TLS** in front (reverse proxy) — session cookies are `Secure`.
2. Keep authentication on (it is on by default).
3. List your real origin(s) in `CORS_ALLOWED_ORIGINS` /
   `REALTIME_ALLOWED_ORIGINS` (wildcards are refused).
4. Set `EXPOSE_ACKNOWLEDGED=true` once protected, to silence the boot warning.

The **[security.md](security.md)** page has a Caddy example, the
config reference, and a pre-exposure checklist. A VPN is the simplest safe
option for personal remote access.

---

## Troubleshooting

- **Port already in use** — `3000` (Core) and `4200` (web client) must be
  free, or change `PORT` / the compose port mapping. Both compose variants
  bind the same ports; stop one before starting the other.
- **`host.docker.internal` does not resolve** — on Linux, add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to the `core` service,
  or use the host's LAN address.
- **Login seems to work but you are immediately logged out** — over plain
  HTTP on a non-localhost address the `Secure` cookie is not stored. Use
  HTTPS, or set `AUTH_COOKIE_SECURE=false` for trusted loopback/LAN
  development only.
- **Server settings says the vault is disabled** — no master key is
  configured; set `VAULT_KEY_FILE` (or `VAULT_KEY`) and restart.
- **A provider shows "missing" key** — its `apiKeyRef` does not resolve; store
  the referenced secret or export the referenced `$VAR`.
- **An MCP server is `failed`** — hover/expand its reason in the MCP tab; a
  missing referenced secret fails the server closed by design.
- **Web client build runs out of memory** — give Docker more memory (see
  [Requirements](#requirements)).
- **The model cannot call a tool you expected** — tool discovery may not have
  injected it (see [Tool discovery](#tool-discovery)); the model can pull it
  via `search_platform_tools`, or you can stage it with `/tools pull <query>`.

---

## Documentation map

| Document | Contents |
| --- | --- |
| [README](../README.md) | What ICOS is, why, design goals, milestones, architecture |
| [INDEX](../INDEX.md) | Annotated repository map |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Plain-English feature guide: what it does, how, verified status, benefits |
| [security.md](security.md) | Exposure, TLS, authentication, secrets |
| [skill-blueprint.md](skill-blueprint.md) | How to author a skill |
| [tool-blueprint.md](tool-blueprint.md) | How to author a tool |
| [model-lineups.md](model-lineups.md) | Which models to run, and the memory budget |
| [releases.md](releases.md) | Release history and milestone changelog |
| `../.reference/plans/` | Milestone plans and verification evidence |
