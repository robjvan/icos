---
name: daily-journal
description: "Interview the user about their day, then write a structured journal entry (Highlights, Work, People, Open loops) to ~/.icos/workspace/journal/."
version: 1.0.0
author: ICOS
license: MIT
platforms: [linux, macos, windows]
metadata:
  tags: [journal, reflection, daily, notes]
  related_skills: [capture-idea, weekly-review-planning]
---

# Daily Journal

Interview the user about today, then write a structured journal entry. The
journal is the user's own record — accuracy matters more than polish.

## When to Use

- "Journal my day." / "Let's do the daily journal."
- End-of-day reflection.

Don't use for: weekly planning (`weekly-review-planning`) or idea capture
(`capture-idea`).

## Where entries live

- Directory: `~/.icos/workspace/journal/` (create it if missing).
- Filename: `YYYY-MM-DD.md` — one entry per day. If today's file already exists,
  **append** a new section rather than overwriting it.

## Procedure

### 1. Interview, one question at a time

Ask a single open question, wait for the answer, then ask the next. Cover the
four sections below. Do not batch questions.

### 2. Cover the four sections

- **Highlights** — the moments worth remembering.
- **Work** — what moved, what stalled, what's next.
- **People** — who mattered today, and how.
- **Open loops** — unresolved threads, follow-ups, things to pick up.

### 3. Never invent

Record only what the user actually said. If a section has nothing, write "—" or
omit it. Do not pad with plausible-sounding events.

### 4. Write the entry

Produce the entry as markdown, show it to the user for confirmation, then save
it to the path above.

## Output Shape

```markdown
# YYYY-MM-DD

## Highlights

- …

## Work

- …

## People

- …

## Open loops

- …
```

## Pitfalls

- Inventing events the user did not mention.
- Batching questions instead of asking one at a time.
- Overwriting an existing day's entry.
- Turning the journal into advice — it is the user's record, not a coaching log.

## Verification

- [ ] One question at a time; all four sections covered.
- [ ] Only user-stated content; nothing invented.
- [ ] Saved to `~/.icos/workspace/journal/YYYY-MM-DD.md`.
- [ ] Any existing entry was preserved (appended, not overwritten).
