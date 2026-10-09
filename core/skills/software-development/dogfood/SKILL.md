---
name: dogfood
description: "Exploratory QA of web apps: find bugs, evidence, reports."
version: 1.0.0
author: Teknium (teknium1), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [qa, testing, browser, web, dogfood]
    related_skills: []
---

# Dogfood: Systematic Web Application QA Testing

## Overview

Systematic exploratory QA of web applications using ICOS' `browser` tool. You
navigate the app, interact with elements, capture evidence, and produce a
structured bug report.

## Prerequisites

- The `browser` tool (Playwright + headless Chromium). It exposes a small action
  set: `navigate`, `snapshot`, `click`, `type`, `scroll`, `screenshot`.
- A target URL and testing scope from the user.

### Capabilities & limitations (ICOS browser)

ICOS ships a **minimal** browser tool. Plan around these differences from a full
browser toolset:

| Capability | ICOS |
| --- | --- |
| Navigate / snapshot / click / type / scroll / screenshot | ✅ |
| Element targeting | **CSS selectors** (`selector`), not accessibility refs (`@eN`) |
| JS console capture | ❌ not available — rely on the snapshot text and visual review |
| Keyboard press / history back | ❌ not available — navigate by URL instead |
| Annotated screenshots | ❌ — take a `screenshot`, then run `vision_analyze` on the saved path |

`navigate`, `snapshot`, and `click` return `{url, title, text, truncated}`
(the page's visible text). `screenshot` returns `{path}` under
`<workspace>/browser/`.

## Inputs

The user provides:
1. **Target URL** — the entry point for testing
2. **Scope** — what areas/features to focus on (or "full site")
3. **Output directory** (optional) — default `./dogfood-output`

## Workflow

### Phase 1: Plan

1. Create the output directory structure:
   ```
   {output_dir}/
   ├── screenshots/       # Evidence screenshots
   └── report.md          # Final report (generated in Phase 5)
   ```
2. Identify the testing scope.
3. Plan which pages/features to test: landing/home, navigation links, key user
   flows (sign up, login, search, checkout), forms, edge cases (empty states,
   error pages, 404s).

### Phase 2: Explore

For each page or feature in the plan:

1. **Navigate**:
   ```
   browser {action: "navigate", url: "https://example.com/page"}
   ```

2. **Read the snapshot** (returned by navigate) to understand the page text and
   structure:
   ```
   browser {action: "snapshot"}
   ```

3. **Take a screenshot** and analyze it visually:
   ```
   browser {action: "screenshot"}          # → {path: "<workspace>/browser/<id>.png"}
   vision_analyze {image_path: "<path>", question: "Describe the layout and flag visual issues, broken elements, or accessibility concerns."}
   ```
   Do this after each navigation and after significant interactions — layout
   problems and silent failures are high-value findings.

4. **Test interactive elements** systematically (CSS selectors):
   - Click buttons/links: `browser {action: "click", selector: "button.submit"}`
   - Fill forms: `browser {action: "type", selector: "#email", text: "a@b.c"}`
   - Scroll: `browser {action: "scroll", dy: 800}` (negative scrolls up)
   - Test form validation with invalid inputs; test empty submissions

5. **After each interaction**, re-check the returned snapshot text and take a
   fresh screenshot (the console is unavailable, so visual + text are your
   evidence).

### Phase 3: Collect Evidence

For every issue found:

1. **Screenshot** the issue:
   ```
   browser {action: "screenshot"}
   ```
   Save the `path` — you will reference it in the report.

2. **Record the details**: URL, steps to reproduce, expected vs actual behavior,
   any visible errors, screenshot path.

3. **Classify** using the issue taxonomy (see `references/issue-taxonomy.md`):
   - Severity: Critical / High / Medium / Low
   - Category: Functional / Visual / Accessibility / UX / Content

### Phase 4: Categorize

1. Review all collected issues.
2. De-duplicate (merge the same bug across pages).
3. Assign final severity and category.
4. Sort by severity (Critical first).
5. Count issues by severity and category for the summary.

### Phase 5: Report

Generate the report using `templates/dogfood-report-template.md`:

1. **Executive summary** — total issue count, breakdown by severity, scope
2. **Per-issue sections** — number/title, severity + category, URL, description,
   steps, expected vs actual, screenshot reference, visible errors
3. **Summary table** of all issues
4. **Testing notes** — what was tested, what was not, blockers

Save to `{output_dir}/report.md`.

## Tools Reference

| Action | Purpose |
| --- | --- |
| `browser {action:"navigate", url}` | Go to a URL (returns the snapshot) |
| `browser {action:"snapshot"}` | Page text + title + url |
| `browser {action:"click", selector}` | Click an element (CSS selector) |
| `browser {action:"type", selector, text}` | Type into an input |
| `browser {action:"scroll", dy}` | Scroll (positive down, negative up) |
| `browser {action:"screenshot"}` | Save a PNG under `<workspace>/browser/` |
| `vision_analyze` | Analyze a saved screenshot |

## Tips

- **Snapshot + screenshot after every navigation and significant interaction** —
  the JS console is not available, so visible text and pixels are the evidence.
- **Prefer stable CSS selectors** (`#id`, `[name=...]`, `button.primary`) — there
  are no accessibility refs.
- **Test with both valid and invalid inputs** — form-validation bugs are common.
- **Scroll through long pages** — below-the-fold content may render badly.
- **Test multi-step navigation flows** end-to-end.
- **Don't forget edge cases**: empty states, very long text, special characters,
  rapid clicking.
- Reference screenshots in the report as their workspace-relative path.
