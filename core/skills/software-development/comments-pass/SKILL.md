---
name: comments-pass
description: "A complete documentation-comment pass: Swagger for HTTP surfaces, JSDoc for exports — comments and annotations only, never behavior changes."
version: 1.0.0
author: ICOS
license: MIT
platforms: [linux, macos, windows]
metadata:
  tags: [documentation, comments, jsdoc, swagger, code-quality]
  related_skills: [simplify-code, codebase-inspection]
---

# Comments Pass

Do a complete documentation-comment pass over a file, module, or codebase: add
Swagger/OpenAPI annotations to HTTP surfaces and JSDoc to exported functions,
types, and modules. This is a **comments-only** change — no behavior, no
signatures, no formatting.

## When to Use

- "Document this file/module."
- "Add JSDoc / Swagger to the public API."
- Before a release or handoff, to close documentation gaps.

Don't use for: rewriting or refactoring code (`simplify-code`), or hunting bugs
(`systematic-debugging`).

## Procedure

### 1. Scope and inventory

Identify the target(s) and enumerate the public surface: exported functions,
classes, types, constants, and HTTP routes/controllers. Done when you can list
every symbol that needs a doc comment.

### 2. Read before writing

Read each symbol fully, plus its call sites where intent is unclear. Document
what the code **does**, not what it should do. Done when every comment is
grounded in the actual implementation.

### 3. Write the comments

- **HTTP surfaces:** Swagger/OpenAPI annotations — operation summary, parameters,
  request/response schemas, status codes, and error responses.
- **Exports:** JSDoc — a one-line summary, `@param` (name, type, meaning),
  `@returns`, `@throws`, and `@example` where it clarifies usage.
- Match the project's existing comment style and tooling.

Done when every public symbol has an accurate comment and the doc tooling (if
any) builds clean.

### 4. Flag, don't silently fix

If a comment is stale, contradictory, or documents behavior the code no longer
has, **flag it** in your report. Do not silently rewrite someone else's comment
to match the code unless asked.

### 5. Verify comments-only

Confirm the diff touches comments and doc annotations only — no logic,
signatures, imports, or formatting.

## Output Shape

1. Files and symbols covered.
2. Comments added, grouped by surface.
3. Stale or contradictory comments flagged, with location.
4. Anything intentionally left undocumented, and why.

## Pitfalls

- Changing behavior "while documenting" — forbidden.
- Documenting intent the code does not implement.
- `@param` names that don't match the signature.
- Restating the type in prose (`@param {string} id The id`) with no meaning.
- Deleting a comment that looked wrong but was a deliberate warning.

## Verification

- [ ] The diff is comments/annotations only — no behavior change.
- [ ] Every public symbol in scope has an accurate comment.
- [ ] Doc tooling (if any) builds/lints clean.
- [ ] Stale or contradictory comments were flagged, not silently rewritten.
