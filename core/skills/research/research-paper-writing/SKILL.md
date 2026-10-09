---
name: research-paper-writing
title: Research Paper Writing Pipeline
description: "Write ML papers for NeurIPS/ICML/ICLR: design→submit."
version: 1.1.0
author: Orchestra Research
license: MIT
dependencies: [semanticscholar, arxiv, habanero, requests, scipy, numpy, matplotlib, SciencePlots]
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Research, Paper Writing, Experiments, ML, AI, NeurIPS, ICML, ICLR, ACL, AAAI, COLM, LaTeX, Citations, Statistical Analysis]
    category: research
    related_skills: [arxiv, jupyter-notebook]
    requires_toolsets: [terminal, files]
---

# Research Paper Writing Pipeline

End-to-end pipeline for publication-ready ML/AI papers targeting **NeurIPS, ICML,
ICLR, ACL, AAAI, and COLM**: experiment design → execution → monitoring →
analysis → writing → review → revision → submission. It is **iterative, not
linear** — results trigger new experiments, reviews trigger new analysis.

```
Phase 0 Setup → Phase 1 Literature → Phase 2 Design → Phase 3 Execution
   → Phase 4 Analysis → Phase 5 Drafting → Phase 6 Review → Phase 7 Submission
   → Phase 8 Post-Acceptance
Phase 4 ⇄ Phase 2 (more experiments); Phase 6 ⇄ Phase 5 (revision)
```

## When to Use

- Starting a paper from a codebase/idea; designing or running experiments
- Writing/revising any section; preparing a submission; responding to reviews
- Converting between venues; non-empirical papers (theory/survey/benchmark/position)
- Designing human evaluations; preparing post-acceptance deliverables

## Core Philosophy

1. **Be proactive** — deliver complete drafts, not questions; iterate on feedback.
2. **Never hallucinate citations** — AI citations err ~40%; always fetch
   programmatically and mark unverifiable ones `[CITATION NEEDED]`.
3. **A paper is a story, not a pile of experiments** — one clear contribution.
4. **Experiments serve claims** — every experiment names the claim it supports.
5. **Commit early, often** — the git log is the experiment history.

Draft first, ask with the draft. Block for input only when the venue is unclear,
framings conflict, results look incomplete, or the user asks to review first.

## Phase 0 — Project Setup

Explore the repo (`ls`, find `results/`/`configs/`/`.bib`), establish the
workspace (`paper/`, `experiments/`, `code/`, `results/`, `tasks/`,
`human_eval/`), set up git, articulate the one-sentence contribution
(What/Why/So What), create a `todo` plan, estimate the compute budget (add
30-50% contingency), and agree author/section ownership plus LaTeX conventions
early.

## Phase 1 — Literature Review

Find seed papers in the repo; search with `web_search` and load the **`arxiv`**
skill for structured discovery. Use breadth-then-depth rounds (breadth → depth →
targeted) and stop when a round returns >80% known papers (2-3 rounds; 4-5 for
surveys). **Verify every citation** (search → verify in 2+ sources → fetch BibTeX
via DOI → validate the claim → add); never write BibTeX from memory. Group
related work by methodology, not paper-by-paper. Full API details and the
`CitationManager` class: `references/citation-workflow.md`.

## Phase 2 — Experiment Design

Map each claim to an experiment (claim → experiment → expected evidence); if an
experiment maps to no claim, don't run it. Design naive/strong/ablation/
compute-matched baselines, and fix metrics, aggregation, statistical tests, and
sample sizes before running anything. Write scripts with incremental saving
(skip completed work) and separate generation/evaluation/visualization. Design
human evaluation early when needed. See `references/experiment-patterns.md` and
`references/human-evaluation.md`.

## Phase 3 — Execution & Monitoring

Launch with `nohup … &` (record the PID); beware API rate limits with >4
concurrent jobs. Schedule periodic checks with `cronjob_manage`; reply `[SILENT]`
when nothing changed. Handle failures (rate limits → wait/rerun; crashes → rerun
from checkpoint; timeouts → kill/skip). Commit each completed batch. Keep an
experiment journal (`experiment_journal.jsonl`) capturing the exploration tree
(hypothesis → plan → result → next), and snapshot the script per run.

## Phase 4 — Analysis

Aggregate results; compute error bars + 95% CIs + pairwise tests (McNemar) +
effect sizes. Answer: the main finding, the surprise, the failures, the
follow-ups. Handle negative/null results honestly (reframe as analysis; venues:
NeurIPS D&B, TMLR, workshops). Figures: vector PDF, colorblind-safe,
self-contained captions, no in-figure title. Tables: `booktabs`, bold best,
direction symbols. Then decide more experiments vs write, and write
`experiment_log.md` (the bridge from results to prose). See
`references/experiment-patterns.md`.

## Iterative Refinement — Strategy Selection

Pick the refinement strategy from the generation-evaluation gap:

| Situation | Strategy |
|---|---|
| Mid-tier model + constrained task | **Autoreason** (sweet spot) |
| Mid-tier + open task | Autoreason + scope constraints |
| Frontier + constrained | Autoreason |
| Frontier + unconstrained | Critique-and-revise / single pass |
| Concrete technical task | Critique-and-revise |
| Template-filling | Single pass |
| Code with tests | Autoreason (code variant) |
| Very weak model | Single pass |

The gap is generation minus self-eval; it is widest at mid-tier, where
autoreason wins most. Loop: critic → author-B → synthesizer → 3 blind judges
(Borda) → converge when A wins k=2. Give the critic ground truth (real results)
and scope-constrain the revision. See `references/autoreason-methodology.md`.

## Phase 5 — Paper Drafting

The full section-by-section procedure (ordering, LaTeX scaffolding, figure/table
conventions, abstract/intro formulas, related-work positioning) is in
`references/phase5-paper-drafting.md`; pair it with `references/writing-guide.md`
for prose-level style rules.

## Phase 6 — Self-Review & Revision

Simulate 3-5 independent reviews (default negative bias) → meta-review (area
chair) → optional reflection loop; use the strongest model for reviewing. Add a
VLM visual pass on the compiled PDF and a claim-verification pass (trace every
number to a result file; a fresh verifier avoids confirmation bias). Prioritize
critical/high/medium/low, revise, then write point-by-point rebuttals (address
every concern, lead with the strongest, never defensive). Snapshot
`paper_vN_*.tex`. See `references/reviewer-guidelines.md`.

## Phase 7 — Submission Preparation

Complete the venue checklist (incomplete → desk reject), run the anonymization
checklist, verify formatting, and run pre-compilation validation (`chktex`,
citations exist, figures exist, no duplicate labels) before `latexmk`. Know
venue-specific requirements (NeurIPS checklist, ICML broader impact, ICLR LLM
disclosure, ACL limitations, AAAI strict style). On resubmission never copy
preambles between templates, and don't reference the prior submission. Full
checklists, pre-compilation scripts, venue tables, arXiv strategy, and code
packaging: `references/submission-and-deliverables.md` and
`references/checklists.md`.

## Phase 8 — Post-Acceptance Deliverables

Poster (title readable at 3 m, bullets only, order early), talk/spotlight (one
idea per slide, takeaway slide), blog/thread (lead with the result). See
`references/submission-and-deliverables.md`.

## Paper Types Beyond Empirical ML

Theory (theorem + proof sketches; full proofs in appendix), survey (taxonomy +
open problems), benchmark (dataset docs + construct validity), position
(argument + counterarguments). See `references/paper-types.md`.

## ICOS Integration

- **`terminal`** — LaTeX (`latexmk -pdf`), git, launching/monitoring experiments.
- **`process_start`** (approval-gated) / **`process_manage`** — background
  experiment processes (start / poll / log / kill).
- **`execute_code`** — Python for citation verification, statistics, aggregation.
- **`read_file` / `write_file` / `patch`** — paper, scripts, result files.
- **`web_search` / `web_extract`** — literature discovery and fetching.
- **`todo`** — cross-session state tracker; **`memory`** — persist key decisions.
- **`cronjob_manage`** — schedule monitoring/deadline jobs (5-field cron
  expression); delivery via `deliver_*`. **`clarify`** — targeted questions.
- Parallel section drafting via `delegate_task` is **not yet available (M21)**;
  draft sections sequentially or in a single pass for now.

Update `todo` and `memory` at each phase transition; at session start list todos,
read memory, run `git log`, and check running processes and `results/`.

## Reviewer Criteria

Quality (soundness, fair baselines) · Clarity (reproducible, consistent
notation) · Significance (impact) · Originality (new insights). NeurIPS 1-6
scale. See `references/reviewer-guidelines.md`.

## Common Issues

Generic abstract → start with your specific contribution. Intro >1.5 pp → move
background to Related Work. Missing significance → error bars, run counts,
statistical tests. Reviewers question reproducibility → release code, document
hyperparameters, include seeds. Negative results → Phase 4. See the full table
in `references/reviewer-guidelines.md`.

## References

`writing-guide.md` · `citation-workflow.md` · `checklists.md` ·
`reviewer-guidelines.md` · `experiment-patterns.md` · `autoreason-methodology.md`
· `human-evaluation.md` · `paper-types.md` · `phase5-paper-drafting.md` ·
`submission-and-deliverables.md` · `sources.md`. LaTeX templates in `templates/`
(NeurIPS 2025, ICML 2026, ICLR 2026, ACL, AAAI 2026, COLM 2025); see
`templates/README.md`.

Key external sources: Nanda, Farquhar, Gopen & Swan, Lipton, Perez (writing);
Semantic Scholar / CrossRef / arXiv APIs.
