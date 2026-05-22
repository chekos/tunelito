---
name: tunelito-ship
description: Prepare Tunelito changes for a PR-ready commit and push, including verification and handoff summary.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

## Current State

!`git status -sb`
!`git diff --stat`

## Instructions

Prepare the current change for shipping:

1. Inspect the diff and ensure docs/tests match behavior.
2. Run `npm run ci`.
3. For package changes, run the tarball install smoke from `docs/agents/RELEASE_PLAYBOOK.md`.
4. Commit with a concise conventional message if the user asked to commit.
5. Push a branch and open a PR when the user asks to ship changes.
6. If pushed, check GitHub Actions.

Do not push directly to `main`; repository rules require pull requests.

Do not publish to npm from a local shell. Use trusted publishing.
