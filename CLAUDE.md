# Tunelito Claude Code Memory

You are working in Tunelito, a local-first CLI that turns any HTML file into a live review room with injected comments.

Read `docs/agents/START_HERE.md` before making changes. For feature, PR, package, or release work, also read `docs/agents/IDEA_TO_RELEASE.md`. The repository is intentionally set up for agent-driven development, so use the playbooks instead of rediscovering process.

## Non-Negotiables

- The source HTML file must remain untouched by the annotation system.
- Comments persist to markdown beside the source page or to the explicit `--out` path.
- Public tunnel sessions require keyed URLs by default.
- Do not edit `*.comments.md`, `.env*`, `.claude/settings.local.json`, `.git/`, `node_modules/`, local archives, or walkthrough exports.
- Use Node.js 22+ and no runtime dependencies unless the benefit is obvious and documented.
- Use Node.js 22 or 24 for Mintlify CLI checks when the CLI rejects newer Node versions.
- Run `npm run ci` before commit or handoff.

## Common Commands

```bash
npm install
npm run check
npm test
npm run pack:check
npm run docs:check
npm run agent:check
npm run ci
node bin/tunelito.js examples/simple-review.html --no-tunnel --port 4317
```

For injected UI, visual, accessibility, screenshot, or browser-behavior changes, read `docs/agents/EXAMPLE_FIXTURES.md` and verify the relevant examples before handoff.

## Workflow

1. Inspect: `git status -sb`, `rg --files`, and the relevant source/tests.
2. Plan briefly in the conversation for non-trivial work.
3. Edit with small patches.
4. Update tests and docs in the same change.
5. Verify with the smallest relevant command, then `npm run ci`.
6. For packaging changes, also perform a clean tarball install smoke.

## Helpful Project Skills

- `/tunelito-implement`: implement a normal feature or fix.
- `/tunelito-start`: orient or resume safely.
- `/tunelito-debug`: reproduce and fix broken behavior.
- `/tunelito-review`: review the current diff.
- `/tunelito-security`: audit or implement security-sensitive work.
- `/tunelito-package`: maintain package metadata and install paths.
- `/tunelito-live-smoke`: run a manual served-page smoke.
- `/tunelito-docs`: keep docs in sync.
- `/tunelito-agent-maintenance`: maintain hooks, skills, agents, and playbooks.
- `/tunelito-pr`: prepare a PR-ready summary.
- `/tunelito-ship`: prepare a beta-ready commit.
- `/tunelito-release`: perform release preparation.

## Helpful Project Subagents

- `tunelito-code-reviewer`: read-only review of code, tests, and docs.
- `tunelito-security-reviewer`: tunnel/file-serving/auth security review.
- `tunelito-package-steward`: package metadata, npm, CI, and release review.
- `tunelito-test-runner`: test strategy and verification review.
