---
name: simple-english
description: "Rewrite text to ASD-STE100 Simplified Technical English."
version: 1.2.0
author: AminBlg (https://github.com/AminBlg/SimpleEnglish), ported by Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [writing, documentation, ste, asd-ste100, technical-writing, editing, anti-ai-slop]
    category: creative
    homepage: https://github.com/AminBlg/SimpleEnglish
    related_skills: [humanizer]
  standard: ASD-STE100 Issue 9 (2025-01-15)
---

# Simple English: Write Like an Aerospace Manual

Write technical text with the rules of ASD-STE100 Simplified Technical English. STE is the controlled language that aerospace and defense manufacturers use for maintenance documentation. The rules exist so that a tired reader who is not a native English speaker cannot misread an instruction. They remove the usual signs of AI-generated text as a side effect: long sentences, synonym rotation, hedges, filler, and decorative clauses.

Write for that tired reader. Each sentence must survive one read.

## How to use it in ICOS

The text usually arrives one of three ways:

1. **Inline.** The user pastes the text into the message. Rewrite it in place and reply with the result.
2. **File.** The user points at a file (README, runbook, docs page). Use `read_file` to load it, then `patch` for targeted section rewrites or `write_file` for a full rewrite. Never touch code blocks, identifiers, or quoted errors (see Untouchables).
3. **Check mode.** The user asks you to audit text for STE compliance instead of rewriting it. Report each violation as rule number + offending text + compliant rewrite, using `references/checklist.md`.

This skill differs from `humanizer`: humanizer restores natural human voice; simple-english enforces a controlled language for technical instructions. For docs, runbooks, and error messages use this skill. For blog posts, essays, and personal writing use humanizer. Do not apply both to the same text.

## Your Task

When asked to write or rewrite technical text:

1. **Select the mode** (pragmatic or strict, below).
2. **Classify each passage** as procedural or descriptive. Every other rule depends on this.
3. **Correct your vocabulary before drafting.** In strict mode, use `make sure that` for the check/verify/confirm/ensure concept — the dictionary rejects all four as verbs. In pragmatic mode, pick one and keep it. Pick ONE noun for config/settings (all are valid technical nouns — pick one and keep it). Use no other word for these concepts in the whole document.
4. **Apply the rules** from the catalog below.
5. **Do the self-check** before you deliver. This step is not optional.
6. **Never touch code**, identifiers, commands, or quoted errors (see Untouchables).

When asked to CHECK text instead of writing it, report each violation as: rule number, the offending text, a compliant rewrite. Cite only rule numbers that exist in this file. Do not cite rule numbers from memory: the numbering is unintuitive and models invent it (tested — an agent without this file cited "Rule 3.1: short sentences"; the real Rule 3.1 is about verb forms).

## Two Modes

| Mode | When | What you apply |
|---|---|---|
| **Pragmatic** (default) | Docs, READMEs, error messages — the user wants clear text | All structural rules. Domain words stay ("idempotent", "webhook"). |
| **Strict** | The user names STE, ASD-STE100, or compliance | Structural rules + full vocabulary discipline, and tell the user that full compliance needs the official dictionary (free at asd-ste100.org). |

## Step 1: Classify the Text

| | Procedural (instructions) | Descriptive (explanations) |
|---|---|---|
| Purpose | Tell the reader what to do | Explain what a thing is or does |
| Verb form | Imperative: "Install the pump." | Simple present/past/future |
| Sentence limit | **20 words** (Rule 5.1) | **25 words** (Rule 6.3) |
| Unit rule | One instruction per sentence (5.2) | One topic per paragraph (6.5), max six sentences per paragraph (6.6) |

Do not mix the two in one passage. A "Getting started" section is procedural. An "Architecture" section is descriptive. A note inside a procedure is descriptive (25-word limit, no imperative).

## Rule Catalog & Vocabulary

The full rule catalog and vocabulary discipline are in `references/catalog.md`.
## Untouchables

These are technical names (Rules 1.5, 8.6). Leave them exact, even when they break vocabulary rules:

- Code blocks, inline code, identifiers, CLI commands, flags, file paths
- Quoted error messages and log lines
- Product names, API endpoint names, config keys
- Numbers with units — each counts as one word in the sentence limit

## Beyond Documentation

Same rules, different targets. Full adaptations in `references/use-cases.md`:

- **Error messages**: state what happened (simple past), the cause if known, then the fix as an imperative. No "Oops", no "Please ensure", no apology filler.
- **Runbooks**: STE's home turf. Imperative steps, conditions first, warnings before the step.
- **Incident reports**: simple past only. "We have identified an issue that may have impacted" becomes "Between 14:02 and 14:31 UTC, 12% of requests failed."
- **Release notes**: breaking changes follow the warning pattern — command first, risk second.
- **Agent instructions (prompts, AGENTS.md)**: a system prompt is a procedure for a reader that cannot ask questions. One instruction per sentence, no "should", condition first.
- **Translation prep**: STE's original job. One meaning per word plus complete grammar removes most translation ambiguity.

## Self-Check Before You Deliver

This step is not optional. Run these four checks on your draft:

1. Count words in your three longest sentences. Over the 20/25 limit → split them.
2. Search your draft for: `'ll`, `'re`, `'s` (contraction), `has been`, `have been`, `should`, `-ing` verbs after a comma, semicolons.
3. Search for every `if` and `when`. Each one stands at the START of its sentence, before the command. "Increase the timeout if the network is slow" → "If the network is slow, increase the timeout."
4. Search for the verbs you did NOT pick in Your Task step 3 (the check/verify/confirm set). Replace every hit with your chosen verb.

Fix what you find, then deliver. For a full audit, run `references/checklist.md`.

## Full Example

**Before (real unedited AI output):**

> **Connection timeouts.** If sqlpipe hangs or fails with `dial tcp: i/o timeout`, check that the host running sqlpipe can reach the Postgres port (usually 5432) — this is often a security group or firewall rule blocking the connection. If you're connecting to a managed database (RDS, Cloud SQL, etc.), confirm the instance allows connections from sqlpipe's IP. You can also try increasing `source.connect_timeout_seconds` in your config, since a slow network path can trip the default timeout even when the connection eventually succeeds.

**After (classified procedural, verb = "make sure", conditions first, one instruction per sentence):**

> **Connection timeouts.** sqlpipe stops with `dial tcp: i/o timeout` when it cannot reach the Postgres port (5432 by default).
>
> 1. Make sure that the host that runs sqlpipe can reach the Postgres port. A firewall or security group usually blocks it.
> 2. If the database is managed (RDS, Cloud SQL), make sure that the instance accepts connections from the IP of sqlpipe.
> 3. If the network is slow, increase `source.connect_timeout_seconds` in the configuration.

What changed: 40-word sentences split under 20; "you're" expanded; "check/confirm" collapsed to "make sure that"; every condition moved before its command; "etc." removed; code and error strings untouched.

## Limits

STE is for technical facts and instructions. Do not apply it to marketing copy, blog voice, or brand writing — it deletes persuasion by design. When a user asks for STE on marketing text, say so and offer it for the docs instead.

This skill is an unofficial aid. It is not affiliated with or endorsed by ASD or STEMG, and no tool can guarantee STE compliance. ASD-STE100 is a registered trademark of ASD. The official standard is a free download at asd-ste100.org.

## References

- `references/checklist.md` — full verification pass with searchable patterns, for check mode and final audits
- `references/use-cases.md` — long-form adaptations: error messages, runbooks, incident reports, commits, UI copy, i18n
