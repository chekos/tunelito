---
name: tunelito-debug
description: Reproduce and fix Tunelito bugs. Use when behavior is broken, tests fail, comments do not sync, tunnels fail, mobile selection fails, or the CLI does something surprising.
allowed-tools: Read, Grep, Glob, Bash
---

## Current Status

!`git status -sb`

## Debug Loop

1. Reproduce the symptom with the smallest command or test.
2. Capture the expected behavior from README, docs, tests, or user report.
3. Locate the boundary: CLI, server, client, comments, WebSocket, tunnel, package, or agent config.
4. Add or update a failing test when practical.
5. Fix the smallest cause.
6. Run the targeted test, then `npm run ci`.

Use:

- `docs/agents/ARCHITECTURE.md` for boundaries.
- `docs/agents/SECURITY_REVIEW.md` for auth/file-serving/tunnel bugs.
- `docs/agents/QUALITY_GATES.md` for verification.

Return the root cause, changed files, and checks run.
