---
name: tunelito-pr
description: Prepare a GitHub PR or PR-ready summary for Tunelito changes. Use when opening a PR, updating PR notes, or summarizing commits for review.
disable-model-invocation: true
argument-hint: [optional-pr-context]
allowed-tools: Read, Grep, Glob, Bash
---

## Current Changes

!`git status -sb`
!`git log --oneline -8`

## Instructions

Prepare a concise PR summary:

1. State the user-facing change.
2. List implementation bullets.
3. List verification commands and results.
4. Call out security/package/doc implications.
5. Note any follow-up risks.

Do not open or merge a PR unless the user explicitly asks.
