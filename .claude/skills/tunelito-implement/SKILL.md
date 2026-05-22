---
name: tunelito-implement
description: Implement a Tunelito feature or bug fix following repo playbooks, tests, docs, and release-safe habits.
---

## Current Context

!`git status -sb`
!`rg --files -g '!*node_modules*' -g '!*.comments.md' | sed -n '1,120p'`

## Instructions

Implement the requested change using the Tunelito workflow:

1. Read `docs/agents/START_HERE.md`, `docs/agents/WORKFLOW.md`, and the relevant source/tests.
2. Make focused edits only.
3. Add or update tests for behavior changes.
4. Update README/CHANGELOG/playbooks when public behavior or agent process changes.
5. Run the quality gate from `docs/agents/QUALITY_GATES.md`.
6. Summarize changed files, checks, and risks.

Preserve unrelated work. Do not edit `*.comments.md`, `.env*`, `files.zip`, `node_modules/`, or `.git/`.
