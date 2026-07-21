# Agent Instructions

Tunelito is maintained by coding agents. Treat this repository as an agent-native workspace: read the playbooks, make changes in small verified steps, and leave the repo easier for the next agent.

## Start Here

1. Read `docs/agents/START_HERE.md`.
2. For feature, PR, package, or release work, read `docs/agents/IDEA_TO_RELEASE.md`.
3. Check `git status -sb` before editing.
4. Use `rg` for search and `npm run ci` before shipping.
5. Preserve user data: do not edit `*.comments.md`, `.env*`, local archives, walkthrough exports, or generated tunnel/session artifacts unless the user explicitly asks.

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
- Commit only after tests pass. Changes to `main` must go through pull requests; the repository ruleset rejects direct pushes to `main`.

## Bundled Skill Distribution

- `docs-site/skill.md` is the authoritative Tunelito skill distributed by `tunelito skill show` and package installs.
- When a package release includes material bundled-skill changes—commands, flags, modes, lifecycle, safety guidance, or agent workflow—the release is not complete until the BNS Marketplace copy at `/Users/chekos/projects/gh/bns-marketplace/writing/skills/tunelito/SKILL.md` matches it byte-for-byte.
- In the same BNS Marketplace PR, bump the writing plugin version in both `.claude-plugin/marketplace.json` and `writing/.claude-plugin/plugin.json`, verify the versions match, verify exact skill parity with `cmp`, and merge the PR so the marketplace actually receives the update.
- If the BNS repository is unavailable or authentication blocks the sync, report the release as blocked and leave a durable BNS issue or PR. Never silently skip the marketplace sync or describe the release as fully complete while the copies differ.

## Documentation Map

- `docs/agents/START_HERE.md`: repo orientation for any agent.
- `docs/agents/IDEA_TO_RELEASE.md`: end-to-end lifecycle from idea through PR, release, and publish verification.
- `docs/agents/WORKFLOW.md`: standard autonomous development loop.
- `docs/agents/QUALITY_GATES.md`: checks required by change type.
- `docs/agents/EXAMPLE_FIXTURES.md`: repo-local example taxonomy for UI, screenshot, accessibility, and browser regression checks.
- `docs/agents/ARCHITECTURE.md`: system boundaries and invariants.
- `docs/agents/SECURITY_REVIEW.md`: tunnel, file-serving, and hook security checklist.
- `docs/agents/RELEASE_PLAYBOOK.md`: beta/release process.
- `docs/agents/HOOKS.md`: Claude Code hook behavior and maintenance.
- `docs/agents/SKILLS.md`: project skill catalog and validation policy.
- `docs-site/`: Mintlify public documentation source.

## Claude Code

Claude Code project memory is in `CLAUDE.md`; hooks, project skills, and subagents live under `.claude/`. After changing `.claude/agents/`, restart Claude Code so new subagents load.
