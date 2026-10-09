# M18 — Skills Adoption

> Status: **in progress** (started 2026-10-09). **Done:** M18.0 (loader &
> layout), M18.1 (seed + management commands), M18.2 (skills as a workspace
> child). Objective: adopt the 98-skill
> collection into the runtime so the operator can find and edit it, and so the
> model can actually use it. Captured 2026-10-09. Related: **M7** (the skills
> layer this extends), **M17a** (tool enablement), **M20** (web client).

## Objective

Ship the collected skills into `~/.icos/skills/` (visible and editable), fix the
loader so they actually load, and adapt them to ICOS' tools. The collection is
98 `SKILL.md` across 19 categories plus supporting `scripts/`, `references/`,
and `templates/`.

## Decisions (2026-10-09)

- **Keep the category layout:** `~/.icos/skills/<category>/<skill>/SKILL.md`,
  discovered recursively, keyed by the frontmatter `name`.
- **Tolerate extra frontmatter:** accept the real key set
  (`author`, `license`, `platforms`, `metadata`, `tags`, …) and ignore unknown
  keys rather than fail-closed.
- **Adapt all 98** to ICOS (not just the curated subset), sliced by category.

## Why the collection did not load

1. **Layout:** the loader scanned flat (`<root>/<name>/SKILL.md`); the
   collection is two-level (`<category>/<name>/SKILL.md`) → every category dir
   looked like a skill with no file → skipped.
2. **Frontmatter:** the parser fail-closed on unknown keys; the collection uses
   `author`/`license`/`platforms`/`metadata` → all 98 rejected.

## Slices

- **M18.0 — Foundation (loader & layout).** Recursive discovery; tolerant
  frontmatter; `loadBody`/`skill_manage` resolve across the tree. Fixes the
  load. Unit + live.
- **M18.1 — Seed.** *Done.* The collection ships at `core/skills/` (tracked, in
  the image); `SkillSeedService` copies it into `~/.icos/skills/` on startup
  **without overwriting** user edits. Management commands: slash
  `/skills seed|create|delete` + API `POST /core/skills`, `DELETE
  /core/skills/:name`, `POST /core/skills/seed`.
- **M18.2 — Supporting files.** *Done.* The catalog is a **child of the
  workspace** (`<TOOLS_WORKSPACE_ROOT>/skills`), so the existing file/terminal
  tools reach a skill's `scripts/`/`references/`/`templates/` directly — no
  materialization, no boundary change. `SKILLS_DIR_PATH` still overrides.
- **M18.3+ — Adapt by category** (one slice per group):
  - research + web + data-science
  - software-development + devops + mlops + dogfood
  - productivity + note-taking + communication + email
  - creative + media + gaming
  - apple + autonomous-ai-agents + health + social-media + legacy
  Each: rewrite bodies/scripts to ICOS tools, drop Hermes internals
  (`_hermes_home.py`), and handle `delegate_task` → **defer to M21**.
- **M18.x — Per-session enable/disable** (context-window pressure), if the
  existing `/skills use|drop|pull` pinning is not enough.

## The collection (98 skills)

`apple` 4 · `autonomous-ai-agents` 11 · `communication` 1 · `creative` 20 ·
`data-science` 1 · `devops` 2 · `dogfood` 1 · `email` 3 · `gaming` 1 ·
`health` 1 · `legacy` 5 · `media` 3 · `mlops` 3 · `note-taking` 1 ·
`productivity` 14 · `research` 9 · `social-media` 2 · `software-development`
15 · `web` 1.

## Tool-reference surface (bodies)

`terminal` 279 · `browser` 86 · `memory` 58 · `web_extract` 39 ·
`delegate_task` 34 (M21) · `execute_code` 22 · `web_search` 21 ·
`vision_analyze` 20 · `todo` 18 · `clarify` 15.

Most map directly to ICOS tools; the work is syntax, scripts, and
`delegate_task`.
