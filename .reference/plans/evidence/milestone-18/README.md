# Milestone 18 — Skills Adoption

**Status:** complete (per-session enable/disable remains optional, M18.x).

Adopted the 98-skill collection into the runtime: it now lives at `core/skills/`
(baked into the image), seeds into `~/.icos/workspace/skills/` on first run,
loads recursively by category, and the file/terminal tools reach each skill's
supporting scripts. Hermes-specific skills were dropped and the rest adapted to
ICOS tools.

## Slices

| Slice | Summary | Evidence |
| --- | --- | --- |
| M18.0 | Recursive discovery + tolerant frontmatter (fixes the "2 of 20 load" bug) | [m18.0-loader-evidence.md](m18.0-loader-evidence.md) |
| M18.1 | Seed at `core/skills/` + `/skills seed\|create\|delete` + API | [m18.1-seed-evidence.md](m18.1-seed-evidence.md) |
| M18.2 | Skills as a workspace child (tools reach scripts directly) | [m18.2-workspace-child-evidence.md](m18.2-workspace-child-evidence.md) |
| M18.3 | Adapt research + web + data-science | [m18.3-research-evidence.md](m18.3-research-evidence.md) |
| M18.3a | Trim research over-cap bodies into `references/` | [m18.3a-body-trims-evidence.md](m18.3a-body-trims-evidence.md) |
| M18.4 | Adapt software-development + devops + mlops + dogfood | [m18.4-sw-dev-evidence.md](m18.4-sw-dev-evidence.md) |
| M18.5 | Adapt productivity + note-taking + communication + email | [m18.5-productivity-evidence.md](m18.5-productivity-evidence.md) |
| M18.6 | Adapt creative + media + gaming | [m18.6-creative-evidence.md](m18.6-creative-evidence.md) |
| M18.7 | Adapt apple + autonomous-ai-agents + health + social-media | [m18.7-final-group-evidence.md](m18.7-final-group-evidence.md) |
| M18.x | Per-session enable/disable (`/skills on\|off`) | [m18.x-y-session-seed-evidence.md](m18.x-y-session-seed-evidence.md) |
| M18.y | Seed `--force` (shipped-skill update path) | [m18.x-y-session-seed-evidence.md](m18.x-y-session-seed-evidence.md) |

## Final state

- **88 shipped skills** load (recursive, by category); every skill is under the
  12 000-char body cap.
- **10 Hermes-app-specific skills dropped:** `python-debugpy`,
  `node-inspect-debugger`, `inspecting-hermes-desktop-dom`,
  `hermes-agent-skill-authoring`, `teams-meeting-pipeline`, `unreal-mcp`,
  `impeccable`, `hermes-agent`, `honcho`, `computer-use`.
- Adaptations: `~/.hermes` → workspace/`core/.env`; `browser_*` →
  `browser`; `cronjob(...)` → `cronjob_manage({...})`; `skill_view(file)` →
  `read_file`; `delegate_task` → noted as **M21** with inline fallbacks.
- Totals at close: **1179 unit / 66 e2e**, `tsc`/`eslint` clean.

## Remaining

None. M18.x (per-session enable/disable) and M18.y (seed `--force` update path)
are both complete.
