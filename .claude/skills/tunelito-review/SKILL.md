---
name: tunelito-review
description: Review the current Tunelito diff for bugs, regressions, security issues, missing tests, and docs drift.
---

## Current Diff

!`git diff --stat`
!`git diff -- . ':(exclude)package-lock.json' | sed -n '1,260p'`

## Instructions

Take a code-review stance:

- Findings first, ordered by severity.
- Use file and line references.
- Prioritize bugs, regressions, security risks, missing tests, and docs drift.
- Keep summary secondary.

Check the change against:

- `docs/agents/ARCHITECTURE.md`
- `docs/agents/SECURITY_REVIEW.md`
- `docs/agents/QUALITY_GATES.md`

If there are no findings, say so and identify any residual risk or skipped checks.
