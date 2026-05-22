# Agent Instructions

Tunelito is maintained by coding agents. Treat this repository as an agent-native workspace: read the playbooks, make changes in small verified steps, and leave the repo easier for the next agent.

## Start Here

1. Read `docs/agents/START_HERE.md`.
2. Check `git status -sb` before editing.
3. Use `rg` for search and `npm run ci` before shipping.
4. Preserve user data: do not edit `*.comments.md`, `.env*`, `files.zip`, or generated tunnel/session artifacts unless the user explicitly asks.

## Project Commands

```bash
npm install
npm run check
npm test
npm run pack:check
npm run agent:check
npm run ci
```

## Operating Rules

- Prefer minimal, focused changes that match the existing plain Node.js ESM style.
- Do not add runtime dependencies without a clear package-quality reason.
- Keep Tunelito local-first: the source HTML is never modified by the annotation layer.
- Maintain the public CLI contract in `README.md`, `CHANGELOG.md`, and tests whenever behavior changes.
- Treat tunnel sharing as security-sensitive. Default posture is keyed links and clear exposure warnings.
- Commit only after tests pass. Push to `main` only when the user explicitly asks or the task says to take it all the way.

## Documentation Map

- `docs/agents/START_HERE.md`: repo orientation for any agent.
- `docs/agents/WORKFLOW.md`: standard autonomous development loop.
- `docs/agents/QUALITY_GATES.md`: checks required by change type.
- `docs/agents/ARCHITECTURE.md`: system boundaries and invariants.
- `docs/agents/SECURITY_REVIEW.md`: tunnel, file-serving, and hook security checklist.
- `docs/agents/RELEASE_PLAYBOOK.md`: beta/release process.
- `docs/agents/HOOKS.md`: Claude Code hook behavior and maintenance.
- `docs/agents/SKILLS.md`: project skill catalog and validation policy.
- `docs-site/`: Mintlify public documentation source.

## Claude Code

Claude Code project memory is in `CLAUDE.md`; hooks, project skills, and subagents live under `.claude/`. After changing `.claude/agents/`, restart Claude Code so new subagents load.
