# M17 — Tools Expansion

> Status: **in progress** (started 2026-10-07). **Done:** M17a (enablement
> layer); M17b.1–6 (files, web, skills, todo, memory) — with live evidence under
> `.reference/plans/evidence/milestone-17/`. **Remaining Tier 1:** clarify,
> vision/image. **Tiers 2–3:** not started. Captured
> 2026-10-05. Source material:
> `.reference/notes/tools-and-skills-list.md` (the desired tools) and
> `.reference/legacy/tools/hermes-tools/` (the Hermes 0.20 reference).
> Related: **M18 Skills Adoption**, **M19 Dynamic MCP toolsets**, **M16.2d
> attachment vision**, **M21 Subagents** (`delegate_task`).

## Objective

Give ICOS a real tool surface — the capabilities in the tools list — without
inheriting Hermes' framework. All tools land in this milestone, **sliced by
tier**; the cross-cutting pieces (enablement/policy, sandbox strategy) are
designed here because later milestones (M21 subagents, M19 MCP toolsets) build
on them.

## What the reference actually is (triage, 2026-10-05)

`hermes-tools/` is **285 `.py` files, ~98.6k lines, 11MB** — the entire Hermes
tools package *plus framework glue*, not a library:

- Heavily coupled to the rest of Hermes: `tools` (1005 imports), `hermes_cli`
  (223), `agent` (201), `gateway` (89), `hermes_constants` (89), `cron`,
  `plugins`, `hermes_state`.
- Each tool is spread across many helpers (`browser_*` = 22 files,
  `delegate_*` = 9, `mcp_*` = 23), with large entry points (`browser_tool.py`
  1366, `terminal_tool.py` 1406, `file_tools.py` 1308, `code_execution_tool.py`
  932, `skill_manager_tool.py` 907, `vision_tools.py` 1061).
- External deps reveal the surface: `httpx/requests`, `mcp`, `psutil`,
  `PIL/numpy`, `websockets`, `openai/pydantic`, `telegram`, `lark_oapi`,
  `vercel/daytona/modal`, `fal_client`, `faster_whisper/sounddevice/
  openwakeword/sherpa_onnx`, `ptyprocess/termios`.

**Principle: port capabilities, not files.** Reimplement on ICOS's existing
boundaries (tool registry + schemas + validators, approval parking, agent loop,
MCP client, skills service, vault). Hermes' module split is a liability; its
*behavior and schemas* are the value.

## Cross-cutting design (do these first)

### A. Tool enablement / policy layer *(own slice)*

Hermes gates tools by **toolset** + `disabled_toolsets` + runtime
`check_*_requirements` (e.g. browser CDP only when a CDP endpoint exists). ICOS
has `approval` and foreign/MCP tools but **no per-session enablement or
availability model**. Needed for:

- **Tools**: expose only relevant tools per session/model (context + safety).
- **Skills** (M18): enable/disable per session so a 150-skill library does not
  flood every turn (caching helps cost, not context window).
- **Security**: per-session capability boundaries and approval tiers.

Design sketch: a session-scoped **toolset** (named bundles, enable/disable,
default sets) + a per-tool **availability** signal (health/requirements) +
**approval tier** (none/required). The agent planning frame should declare
disabled/unavailable tools explicitly (absence is deliberate, never silent —
mirroring M13c's unavailable-foreign-server pattern). This layer is also the
foundation of **M19** (dynamic `mcp-<server>` toolsets).

### B. Sandbox / worker strategy *(decide early; discuss)*

Some tools must not run arbitrary work in the core process. Options (lean
toward the simplest that is honest):

- **terminal / process**: host subprocess (`node-pty`/`child_process`) with a
  working-directory jail + approval. Simplest, weakest isolation.
- **execute_code**: a **worker** (sandboxed) with a tool-RPC bridge, so scripts
  can call ICOS tools programmatically. Likely a sibling container (compose
  service) over stdio/HTTP. Python worker is fine here (Hermes parity).
- **browser**: Playwright (TS) with headless Chromium (host or container).
- **computer_use**: external `cua-driver` on the host — defer.
- **cron**: in-process scheduler with durable jobs (SQLite) — no sandbox.

Recommendation: ship Tier 1 with no sandbox; when Tier 3 lands, add **one
sibling "sandbox" compose service** shared by terminal/execute_code/browser
rather than ad-hoc host execution. Decision deferred to the Tier 3 slice; see
Open Questions.

### C. Credentials

Every keyed tool (web search, FAL, docker registry, …) resolves through the
existing **vault/secret resolver**; catalogs hold references only.

### D. Workspace & KB (note, 2026-10-06)

The file tools are confined to `TOOLS_WORKSPACE_ROOT`. The operator intends a
**KB folder as a child of the workspace** (e.g. `<root>/kb/`), so the agent
reaches it under the one root — no second boundary, no S3.

Consequence to decide: if the workspace is the agent's own sandbox, then file
**writes inside it can be approval-free** ("unfettered KB access" implies this);
otherwise writes stay gated and the KB needs a carve-out. This choice also
decides whether `write_file`/`patch` need the native approval-parking path at
all.

## Slices (by tier)

### M17a — Enablement & policy layer
Toolsets/enable/disable, availability/requirements, approval tiers, planning-
frame declaration of disabled tools. Unlocks M18 and M19.

### M17b — Tier 1 tools (TS-native, low risk, high value)
- **Files**: `read_file`, `write_file`, `patch`, `search_files` — *done (M17b.1–2)*
- **Web**: `web_search`, `web_extract` — *done (M17b.3)*
- **Todo**: `todo` — *done (M17b.5)*
- **Clarify**: `clarify` (expose the existing M6 clarification flow as a tool)
- **Session/memory**: extend `session.search`; add a model-facing `memory` tool
  (`beliefs` / `recall` / `persona` / `candidates`) — *done (M17b.6)*
- **Skill view/list**: `skill_view`, `skills_list` — *done (M17b.4)*
- **Vision**: `vision_analyze` (lands with M16.2d; local `gemma4` or a provider)
- **Image**: `image_generate` (FAL API + vault key)

### M17c — Tier 2 tools (design + guardrails)
- **Terminal**: `terminal`, `process_manage` (subprocess + cwd jail + approval)
- **Skill manage**: `skill_manage` (guarded CRUD; frontmatter/security scan)
- **Discord**: `discord`, `discord_admin` (extend the channel adapter; admin
  needs Discord permissions + approval)
- **Docker**: `docker` (local Docker control; approval-gated)

### M17d — Tier 3 tools (sandbox/worker)
- **Browser**: minimal Playwright set first (`navigate`, `snapshot`, `click`,
  `type`, `scroll`, `screenshot`); CDP/vault/dialog/vision later
- **Execute code**: worker + tool-RPC bridge
- **Cron**: `cronjob_manage` (durable scheduler)
- **Computer use**: `computer_use` (external driver) — defer if needed

### M17e — Verification
Unit (schema/validation/approval/availability) + live runs per tier.

## Tool catalog → Hermes mapping

| Tool(s) | Hermes entry | ~Lines | Route | Tier |
| --- | --- | --- | --- | --- |
| read/write/patch/search | `file_tools.py` + ops + `patch`/`fuzzy` | ~8k | TS | 1 |
| web_search/web_extract | `web_tools.py` | 548 | TS | 1 |
| todo | `todo_tool.py` | 285 | TS | 1 |
| clarify | `clarify_tool.py` | 312 | TS (wrap M6) | 1 |
| session_search | `session_search_tool.py` | 680 | TS (extend native) | 1 |
| memory | `memory_tool.py` | 351 | TS (wrap services) | 1–2 |
| vision_analyze | `vision_tools.py` | 1061 | TS (provider) | 1 |
| image_generate | `image_generation_tool.py` | 871 | TS (FAL) | 1–2 |
| skill_view/skills_list | `skills_tool.py` | 692 | TS | 1–2 |
| skill_manage | `skill_manager_tool.py` | 907 | TS (guarded) | 2 |
| discord/discord_admin | `discord_tool.py` + `send_message` | ~1.3k | TS (extend) | 2 |
| terminal/process_manage | `terminal_tool.py` + `process_*` | ~4.2k | TS + sandbox | 2–3 |
| docker | `docker_*` | ~1.3k | TS | 2 |
| browser (18) | `browser_tool.py` + `browser_*` | ~8k | TS/Playwright | 3 |
| execute_code | `code_execution_tool.py` + rpc | ~2.6k | worker | 3 |
| cronjob_manage | `cronjob_tools.py` | 1064 | TS scheduler | 3 |
| computer_use | `computer_use_tool.py` + `cua_*` | ~2.2k | worker (driver) | 3 |
| delegate_task | `delegate_tool.py` + `delegate_*` | ~4.3k | → **M21** | — |

## Deferred / future (not dropped)

- **Voice chat**: **TTS/STT** (local Whisper for STT, Kokoro for TTS),
  **`wake`** (wake-word), and **`voice`** (purpose TBD) — revisit as a
  voice milestone; capture the Hermes reference when we get there.
- **Docker tools**: kept (dropped: sandbox providers vercel/daytona/modal,
  ssh/singularity, and the long tail below).
- **Dropped for now**: tts/transcription/voice (see above), video, x/xai,
  feishu, homeassistant, kanban, drive, microsoft, yuanbao,
  tour/tip/preview/annotate, osv/threat, checkpoint.

## Relationship to M18 (Skills)

The skills side is separate but shares the **enablement layer**: a large,
curated skill library (98 `SKILL.md` in `legacy/`, growing) must be
enable/disable-able **per session** so only relevant skills reach the turn.
Pre-seeding = adapt into a seed bundle → `~/.icos/skills/`; lint frontmatter
(the known `icos-legacy` `bad-frontmatter` skip is the cautionary tale); declare
each skill's external CLI dependencies (many are macOS-only).

## Follow-ups (noted 2026-10-07)

- **Runtime skills don't load:** only 2 of 20 `SKILL.md` in `~/.icos/skills/`
  load (frontmatter / name-mismatch skips). Adapt the files — **M18**.
- **Rejected-call retry:** a validation-rejected tool call
  (`invalid_call_count`) counts as a prior attempt, so an immediate retry hits
  `repeated_call`. Consider not counting rejected proposals as prior attempts.

## Open questions

- **Sandbox choice** (A/B above): host subprocess+jail vs a sibling sandbox
  container. Lean: start simple, add the container for Tier 3. Discuss.
- **Toolset model**: named bundles vs free-form enable lists; how defaults are
  chosen per session/model.
- **Web backend**: which search API (Brave/Serper/SearXNG/…) and extraction
  library; keys via the vault.
- **Approval granularity**: which tools are always approval-gated vs
  configurable (M8 left per-tool toggles as future UI work).
