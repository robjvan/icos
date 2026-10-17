---
name: capture-idea
description: "Draw out an idea, sharpen it (claim, why it matters, falsifier, next step), confirm the wording, and file it in the knowledge base at ~/.icos/workspace/kb/."
version: 1.0.0
author: ICOS
license: MIT
platforms: [linux, macos, windows]
metadata:
  tags: [ideas, knowledge-base, capture, notes]
  related_skills: [daily-journal, obsidian]
---

# Capture Idea

Help the user capture an idea durably: draw it out, sharpen it, confirm the
wording, then file it in the knowledge base. The value is the *filing* — an idea
that is not recorded is lost.

## When to Use

- "Capture this idea." / "Save this thought."
- The user states a nascent idea worth keeping.

Don't use for: journaling the day (`daily-journal`) or general note work
(`obsidian`).

## Where ideas live

- Knowledge base root: `~/.icos/workspace/kb/`.
- Choose a topic-appropriate subfolder (create it if needed); follow the
  conventions in `kb/AGENTS.md`.
- After adding a new file or folder, update `kb/INDEX.md`.
- **Never delete KB files** — even under `_deprecated/` — unless the user
  explicitly asks.

## Procedure

### 1. Draw it out, one question at a time

Elicit, waiting for each answer before the next:

- The core claim, in one sentence.
- Why it matters — what changes if it is true.
- What would prove it wrong (the falsifier).
- The smallest next step.

### 2. Restate for confirmation

End with a compact restatement — claim, why, falsifier, next step — and ask the
user to confirm or correct it **before** anything is written.

### 3. File it

Write a markdown note to the chosen KB location. Include the confirmed claim and
its supporting points. Link related notes where useful.

### 4. Update the index

If you created a file or folder, add it to `kb/INDEX.md`.

## Output Shape

- Confirmed one-line claim
- Why it matters
- Falsifier
- Smallest next step
- Path where it was saved

## Pitfalls

- Recording before the user confirms the restatement.
- Filing at the KB root instead of a topic-appropriate folder.
- Deleting or overwriting KB content.
- Forgetting to update `INDEX.md`.
- Inflating a passing thought into a project.

## Verification

- [ ] One question at a time; claim / why / falsifier / next-step covered.
- [ ] The user confirmed the restatement before the write.
- [ ] Saved under `~/.icos/workspace/kb/` at a topic-appropriate path.
- [ ] `INDEX.md` updated if a new file or folder was added.
- [ ] Nothing was deleted.
