---
name: tunelito-start
description: Orient a new agent in Tunelito. Use at the start of any Tunelito session, after compaction, when resuming work, or when the user says to keep going.
allowed-tools: Read, Grep, Glob, Bash
---

## Current Repo State

!`git status -sb`
!`git log --oneline -5`

## Instructions

Get oriented before touching files:

1. Read `AGENTS.md`, `CLAUDE.md`, and `docs/agents/START_HERE.md`.
2. Inspect the current tree with `rg --files -g '!*node_modules*' -g '!*.comments.md'`.
3. Identify any uncommitted work and whether it appears related to the user request.
4. State the relevant playbook and the first verification command.

Do not edit files from this skill alone. It is for orientation and safe resume.
