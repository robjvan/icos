# M17 — Tools Expansion: evidence index

> Status: **complete** (2026-10-09). **25 native tools** (up from 3). All
> slices have per-slice evidence; two items are deliberately deferred (below).

## Tool surface

| Tool | Slice | Live |
| --- | --- | --- |
| `session.search`, `session.rename`, `channel.send` | pre-M17 | — |
| `read_file`, `search_files` | M17b.1 | ✅ |
| `write_file`, `patch` | M17b.2 | ✅ |
| `web_search`, `web_extract` | M17b.3 | ✅ |
| `skills_list`, `skill_view` | M17b.4 | ✅ |
| `todo` | M17b.5 | ✅ |
| `memory` (beliefs / recall / persona / candidates) | M17b.6 | ✅ |
| `clarify` (park/resume) | M17b.7 | ✅ |
| `vision_analyze` (+ `VISION_LLM_*` role) | M17b.8 | ✅ |
| `image_generate` | M17b.9 | ⚠️ unit-only (no credits/hardware) |
| `terminal` | M17c.1 | ✅ |
| `process_start`, `process_manage` | M17c.2 | ✅ |
| `skill_manage` | M17c.3 | ✅ |
| `discord`, `discord_admin` | M17c.4 | read/info ✅; moderation unit-only |
| `cronjob_manage` | M17d.1 | ✅ |
| `execute_code` (+ tool-RPC bridge) | M17d.2 | ✅ |
| `browser` | M17d.3 | ✅ |

Plus the enablement/policy layer (M17a) and **M16.2d** attachment vision
(separate milestone, evidence in `../milestone-16.2d/`).

## Evidence files

- **M17a / cross-cutting:** enablement layer is covered by the plan and
  `tool-policy.spec.ts` (no standalone evidence doc).
- **M17b:** `m17b-file-tools-evidence.md`, `m17b-web-tools-evidence.md`,
  `m17b-skill-tools-evidence.md`, `m17b-todo-tool-evidence.md`,
  `m17b-memory-tool-evidence.md`, `m17b-clarify-tool-evidence.md`,
  `m17b-vision-tool-evidence.md`, `m17b-image-generate-evidence.md`.
- **M17c:** `m17c-terminal-evidence.md`, `m17c-process-tools-evidence.md`,
  `m17c-skill-manage-evidence.md`, `m17c-discord-evidence.md`.
- **M17d:** `m17d-cron-evidence.md`, `m17d-execute-code-evidence.md`,
  `m17d-browser-evidence.md`.

## Verification at close

- `tsc` + `eslint`: clean.
- Unit: **1177 passed, 1 skipped**.
- E2E: **66 passed**.
- Live: every non-deferred tool was exercised end-to-end through the real turn
  loop (see the per-slice docs).

## Deferred (decided, not dropped)

- **`docker` (M17c.5):** needs the host Docker socket mounted into the core
  container (host-root-equivalent). The agent's own stack testing runs on the
  host shell; `terminal` + an installed CLI would cover it if ever granted.
- **`computer_use` (M17d.4):** cua-driver is a host (macOS) binary with a stdio
  MCP server or a unix-socket daemon; the Linux container cannot reach the host
  socket. Needs a host↔container bridge or a host-run core.
- **`image_generate` live test:** no provider credits / GPU hardware yet.
- **`discord_admin` destructive live test:** would act on real members.
