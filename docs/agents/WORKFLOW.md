# Agent Workflow

Use this loop for every non-trivial task.

## 1. Orient

Run:

```bash
git status -sb
rg --files -g '!*node_modules*' -g '!*.comments.md'
```

Read the nearest docs and tests before editing. For CLI behavior, read `README.md`, `bin/tunelito.js`, and `test/cli.test.js`. For runtime behavior, read the relevant `src/` file and matching tests.

## 2. Classify the Change

- CLI/package: arguments, startup output, versioning, package metadata.
- Server/security: file serving, tunnel URL, auth, WebSocket upgrade, persistence.
- Client/UI: injected browser behavior, selection, mobile, comments panel.
- Docs/process: README, Mintlify docs, release docs, agent playbooks, Claude config.

Use the classification to choose quality gates from `docs/agents/QUALITY_GATES.md`.

## 3. Plan Lightly

For multi-file changes, write a short plan in the conversation. Keep it practical: files to touch, tests to add, verification to run.

## 4. Edit

Keep changes focused. Do not mix unrelated cleanup with functional work. Prefer existing plain Node.js patterns over new abstractions.

When editing:

- Use structured APIs over string hacks when available.
- Keep browser code dependency-free unless a dependency clearly pays for itself.
- Keep CLI output copy synced with README examples.
- Keep tests close to changed behavior.

## 5. Verify

Run targeted checks first, then the full gate:

```bash
npm run check
npm run agent:check
npm run docs:check
npm test
npm run ci
```

For package changes, also run a clean install smoke:

```bash
rm -rf /tmp/tunelito-pack /tmp/tunelito-prefix
mkdir -p /tmp/tunelito-pack /tmp/tunelito-prefix
npm pack --pack-destination /tmp/tunelito-pack
npm install -g --prefix /tmp/tunelito-prefix /tmp/tunelito-pack/tunelito-*.tgz
/tmp/tunelito-prefix/bin/tunelito --version
```

## 6. Handoff

The final response should include:

- what changed
- what verification passed
- commit/push status if requested
- any known limits or follow-up risks

Do not handwave failed or skipped checks.

## 7. PR Discipline

All changes to `main` go through pull requests. The repository ruleset requires:

- a pull request targeting `main`
- passing `Node 22`, `Node 24`, and `Node 26` CI checks
- resolved review conversations
- squash merge

Do not push directly to `main`. Push a branch, open a PR, wait for CI, and merge through GitHub.
