---
name: icos-deploy
description: "Running ICOS: the Docker Compose launch paths, the bin/ helpers, offline local-model (DMR) variants, the ~/.icos data directory, and backup."
version: 1.0.0
author: ICOS
---

# ICOS Deploy — Running the Stack

## Overview

The supported launch path is **Docker Compose**: one command brings up the
runtime and the web client, both health-checked, with data in a single mounted
folder so it survives rebuilds. Helper scripts wrap the verifier + stack combos.

## Status

**Implementation:** Active. Compose and helpers verified; the DMR convenience
path is still marked "in testing".

**Maturity:** Prototype.

**Last reviewed:** 2026-10-17.

## Location

- `docker-compose.yml` — `core` + `web-client`, loopback ports 3000/4200.
- `docker-compose-dmr.yml` — Docker Model Runner override.
- `docker-compose-dmr-local.yml` — fully offline local dual-model override.
- `bin/stack`, `bin/stack-local`, `bin/verifier`, `bin/dmr` — launch helpers.
- `core/Dockerfile`, `web-client/Dockerfile`.
- `core/.env.sample`, `core/.dmr.env.sample` — configuration references.
- `docs/usage.md`, `docs/model-lineups.md` — setup and model choice.

## Commands

```sh
docker compose up --build      # core + web client
bin/stack up [--build]         # claims verifier (host) + stack
bin/stack-local up             # offline local DMR models
docker compose down
```

## Data and configuration

- **Data directory:** `~/.icos/` — `data/` (SQLite), `auth/` (token, session key,
  vault), `verifier/`.
- `core/.env` is local-only and gitignored; `.env` changes require
  `docker compose up -d` (a plain `restart` does not re-read the file).
- Inside a container, `localhost` is the container itself — reach a host model
  server at `host.docker.internal`.

## Invariants

- The compose path must always work: `docker compose up --build` launches a
  healthy `core`.
- Data lives in the mounted folder and survives rebuilds.

## Do Not Assume

- Data is backed up. A restore drill is a v1.0 exit criterion (FG13).
- A 0.6 data directory upgrades silently. Migration is tested as FG12.
