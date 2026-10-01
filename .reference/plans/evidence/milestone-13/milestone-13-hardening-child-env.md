# M13 Hardening Addendum — Child Env Scoping

**Date:** 2026-10-01. **Amends:** M13b "Secrets" (process-env
resolution for spawned MCP servers).

## Why

M13b resolved catalog `env` references at spawn but then handed the
child the **entire** core process environment (`{...process.env,
...extra}`). A stdio MCP server is third-party code: whatever it was
configured to run could read every secret the operator had set (LLM
keys, tokens) just by printing its own environment. For a
self-hosted tool that people download and run, that is the tool
being the reason a machine leaks. Fixed.

## What changed

- `buildChildEnv(env, serverName, source?)` (mcp-server-config.ts):
  the spawn env is now a small **baseline allowlist** (PATH, HOME,
  USER, LOGNAME, SHELL, TERM, TMPDIR, locale/TZ, TLS trust store,
  proxy, npm cache/prefix — present vars only) **plus exactly the
  variables the catalog references**. Everything else in the process
  env is withheld.
- `SdkMcpClient.buildTransport` uses `buildChildEnv`; the HTTP path
  (headers) is unchanged. Missing referenced vars still fail closed
  before spawning, naming the variable only.
- 3 unit tests; live proof below.

## Verification

- **789 unit green** (3 new). `tsc`/`eslint` clean.
- **Live (scratch core, stdio `sh -c 'env > file'` probe)** with a
  sentinel `ICOS_LEAK_SENTINEL=supersecret-value` and
  `BYTESTASH_AUTH` both exported into the core process: the captured
  child env contained only baseline vars (PATH, HOME, LANG, …);
  **sentinel absent, `BYTESTASH_AUTH` absent**. `PWD`/`SHLVL`/`_`
  in the capture are injected by `sh` itself, not inherited from us.
- **Live (unchanged behavior)**: `npx -y
  @modelcontextprotocol/server-everything` still connects (13 tools)
  and ByteStash over HTTP still connects (6 tools) with the reduced
  env — npx/node run fine on PATH+HOME+TMPDIR.

## Contract for operators

A wedged stdio server that "cannot see" a variable it needs is by
design: declare it in the catalog (`"env": { "NAME": "$NAME" }`)
and export it. Nothing is inherited implicitly.
