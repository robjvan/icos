# ICOS — Usage Guide

How to configure, run, and operate ICOS. For what the project *is* and
*why* it is built this way, see the [README](README.md).

- [Deployment target](#deployment-target)
- [Security first](#security-first)
- [Requirements](#requirements)
- [Install](#install)
- [Configure](#configure)
- [Authentication and secrets](#authentication-and-secrets)
- [Run the stack](#run-the-stack)
- [Using the web client](#using-the-web-client)
- [Where data lives](#where-data-lives)
- [Exposing ICOS](#exposing-icos)
- [Troubleshooting](#troubleshooting)

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
checklist: **[docs/security.md](docs/security.md)**.

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
- **Node.js 24.13.0** and **npm 11.6.2** — only needed for local development
  outside Docker.
- An OpenAI-compatible LLM endpoint (local or remote). The model does not
  need to run on the same machine.

---

## Install

```sh
git clone https://git.exilelogic.ca/robjvan/icos.git
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
on the **chat dashboard**. Alongside the chat and memory views, the security
work added three management surfaces (admin-only):

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

A session that expires mid-use sends you back to the login screen
automatically.

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

The **[docs/security.md](docs/security.md)** page has a Caddy example, the
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

---

## Documentation map

| Document | Contents |
| --- | --- |
| [README](README.md) | What ICOS is, why, design goals, milestones, architecture |
| [INDEX](INDEX.md) | Annotated repository map |
| [docs/security.md](docs/security.md) | Exposure, TLS, authentication, secrets |
| [docs/skill-blueprint.md](docs/skill-blueprint.md) | How to author a skill |
| [docs/tool-blueprint.md](docs/tool-blueprint.md) | How to author a tool |
| `.reference/plans/` | Milestone plans and verification evidence |
