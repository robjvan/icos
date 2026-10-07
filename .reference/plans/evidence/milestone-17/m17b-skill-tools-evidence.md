# M17b — Skill tools: live evidence

> Status: **verified** (2026-10-07). Slice **M17b.4** (`skills_list`,
> `skill_view`). Per-slice evidence; M17 itself is still in progress.

## What was built

- `skills_list` — the loaded skill catalog (name, description, version).
- `skill_view` — a skill's full instructions by name (bounded body).
- Both `toolset: 'skills'`, `approval: 'none'`; wired to the existing
  `SkillService` (an optional executor dependency, so unit tests stay light).

## Unit

| Area | Spec |
| --- | --- |
| Validators (accept/reject) | `tool-registry.spec.ts` |
| Execution (list + view via a fake service) | `tool-execution.service.spec.ts` |

Totals at capture: **1117 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **11 tools**.

## Live

Runtime catalog: `~/.icos/skills/` contains **20 `SKILL.md`** files.

**`skills_list`** — *"call the skills_list tool and report how many skills it
returns and their names"*:

```
reply: `skills_list` returned 2 skills:
       1. icos-v2-stack (v0.1.0) — Route work to the correct v2 service …
       2. icos-v3-stack (v0.1.0) — Distinguish between the correct v3 service …
ledger: skills_list {} → succeeded
        result { skills: [ {name, description, version}, … ] }
```

**`skill_view`** — *"call skill_view once with name 'icos-v3-stack' and quote
the first line of its body"*:

```
reply: The first line of its body is: "# ICOS Stack v3 - Development Workspace"
ledger: skill_view { name: "icos-v3-stack" } → succeeded
        result { name, description, version, body: "…" }
```

## Observations

- **Only 2 of 20 skills load.** `skills_list` returned 2 descriptors while the
  directory holds 20 `SKILL.md`. The loader skips the rest (bad frontmatter /
  name mismatch — the known `icos-legacy` `bad-frontmatter` case is one). This
  is a **data/adaptation** concern for **M18 (Skills Adoption)**, not a tool
  defect.
- **One tool call per step.** A turn where the model batched `skills_list` +
  `skill_view` in one response failed with `invalid_call_count` (the loop
  permits exactly one call per proposal), and the retries then hit
  `repeated_call`. The model recovered when instructed to call one tool at a
  time. Worth revisiting whether a validation-rejected call should count as a
  "prior attempt" that blocks an immediate retry.
