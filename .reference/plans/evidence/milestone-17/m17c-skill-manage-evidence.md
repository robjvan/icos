# M17c.3 — Skill manage (`skill_manage`): live evidence

> Status: **verified** (2026-10-07). Slice **M17c.3**. Per-slice evidence; M17c
> is in progress.

## What was built

An approval-free `skill_manage` tool (`toolset: 'skills'`) for **guarded CRUD**
over the skill library:

- **Actions** `create` / `update` / `delete` on `~/.icos/skills/<name>/SKILL.md`.
- **Guards**: kebab-case name (`a-z0-9-`, 1–64); bounded description (≤500) and
  body; a **light content scan** (reject control bytes + a small denylist of
  destructive patterns); and **authoritative validation by the loader's own
  parser before any write**, so a rejected skill leaves nothing on disk.
- **`SkillService.createSkill` / `updateSkill` / `deleteSkill`** write the file
  (0600) then `refresh()` the catalog; `delete` removes the directory. Reused by
  the executor's existing `skills` dependency.
- **Registry**: strict validator — `create`/`update` require `description` +
  `body`; `delete` takes neither; name must be kebab-case.

### Scope note

This is **CRUD only**. Enable/disable per session and the "only 2 of 20 skills
load" problem belong to **M18** (skills adoption). The security scan is a
first-pass guard, not a sandbox — the parser is the real gate.

## Unit

| Area | Spec |
| --- | --- |
| Service: create/load/update/delete; invalid name; duplicate; scan; unknown delete | `skills/skill-manage.spec.ts` |
| Validator (create/update/delete shapes) | `tool-registry.spec.ts` |
| Execution: create → update → delete | `tool-execution.service.spec.ts` |
| Offered-tool surface (20) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1159 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **20 tools**.

## Live

Container rebuilt, healthy.

```
skill_manage {action: create, name: greet-test, description: "Say hi politely.",
              body: "Greet the user warmly and by name."} → ok

skills_list → greet-test (Say hi politely., 0.0.0) now in the catalog

skill_manage {action: update, name: greet-test, description: "Updated greeting.",
              body: "Say hello in a friendly tone."} → ok

skill_manage {action: delete, name: greet-test} → {deleted: true}
```

Host check after the run: `~/.icos/skills/` contains only the pre-existing skills
(`icos-legacy`, `icos-v2-stack`, `icos-v3-stack`) — `greet-test` was created,
listed, updated, and removed cleanly.

## Note

One tool call per step. The writes land in the host-mounted skills directory, so
they persist across container restarts.
