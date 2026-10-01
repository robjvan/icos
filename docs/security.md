# Security

ICOS is a **single-user, self-hosted** tool. The repository is public,
and the goal is that anyone who downloads and runs it is safe **by
default**. This page explains the defaults and how to expose ICOS
deliberately without getting burned.

## TL;DR

- **Default is loopback-only.** Core binds `127.0.0.1`; Docker publishes
  to `127.0.0.1` too. Nothing is reachable from your network until you
  change that.
- **Do not expose ICOS beyond this machine until you have put TLS and
  authentication in front of it.** Authentication inside ICOS is
  planned but **not built yet** (see `security-hardening.md`). Right
  now, anyone who can reach the port can read your conversations and
  spend your LLM credits.
- **There are no wildcard origins.** CORS and the realtime socket accept
  only the origins you list explicitly.

## Where the boundaries are

| Context | What to set | Boundary |
| --- | --- | --- |
| Bare metal, local only | nothing (defaults) | `HOST=127.0.0.1` |
| Docker, local only | nothing (defaults) | publish to `127.0.0.1` |
| LAN | `HOST=0.0.0.0` + a reverse proxy with TLS + auth | your proxy |
| WAN | **only** via a reverse proxy / VPN with TLS + auth | your proxy |

Inside a container the app **must** bind `0.0.0.0` (compose sets this
for you); the real boundary is the published port. `docker-compose.yml`
publishes to `127.0.0.1` by default — change it only when you mean to.

## Relevant settings (`core/.env`)

- `HOST` — interface to bind. Default `127.0.0.1`.
- `CORS_ALLOWED_ORIGINS` — browser origins allowed to call the API,
  comma-separated and exact (`scheme://host:port`). Defaults to the
  bundled local web client. `*` is refused; a path or trailing slash is
  rejected.
- `REALTIME_ALLOWED_ORIGINS` — same rule for the `/core/events` socket;
  falls back to `CORS_ALLOWED_ORIGINS`.
- `EXPOSE_ACKNOWLEDGED` — set to `true` **only** once TLS + auth are in
  front, to silence the off-loopback boot warning. It changes no
  behavior.

When ICOS starts beyond loopback it prints a loud warning until you
acknowledge it. That warning is the point: don't scroll past it.

## Exposing safely (reverse proxy)

Terminate TLS at a proxy and let it require authentication. Example with
[Caddy](https://caddyserver.com/) (automatic HTTPS):

```caddyfile
icos.example.com {
    # Require a login before anything reaches ICOS.
    basicauth {
        you $2a$14$<bcrypt-hash>   # caddy hash-password
    }
    reverse_proxy 127.0.0.1:3000
}
```

Then:
- keep ICOS itself bound to `127.0.0.1` (the proxy reaches it locally),
- set `CORS_ALLOWED_ORIGINS=https://icos.example.com` (and
  `REALTIME_ALLOWED_ORIGINS` if different),
- set `EXPOSE_ACKNOWLEDGED=true` to acknowledge the intended exposure.

Using a VPN (WireGuard/Tailscale) instead of a public hostname is the
least-effort safe option for personal access.

## Secrets

- Provider and MCP keys live in **process environment variables**, never
  in catalog files, never in logs, and are never returned by any API.
- MCP catalog `env`/`headers` values must be `$VAR` references, resolved
  at launch. Missing variables fail that server closed.
- Spawned MCP servers receive a **minimal environment** — a small
  baseline (PATH, HOME, locale, TLS/proxy) plus only the variables their
  catalog entry references. A third-party server cannot read your other
  keys.
- Frontend key entry and an encrypted-at-rest vault are planned (see
  `security-hardening.md`); until then, keys are set in `core/.env`
  (which is git-ignored) and exported before launch.

## Before you expose ICOS

- [ ] TLS is terminating in front of it.
- [ ] Authentication is required by the proxy (built-in auth is not
      available yet).
- [ ] `CORS_ALLOWED_ORIGINS` / `REALTIME_ALLOWED_ORIGINS` list only your
      real origin(s).
- [ ] `core/.env` is not committed and contains no shared/default keys.
- [ ] You understand the boot warning, or you set
      `EXPOSE_ACKNOWLEDGED=true` because you have done the above.

## Reporting

ICOS is an experimental research platform with no security guarantees.
If you find a problem, please open an issue (avoid pasting real secrets).
