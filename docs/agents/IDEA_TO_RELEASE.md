# Idea to Release

Use this as the end-to-end lifecycle map for Tunelito work. It does not replace the detailed playbooks; it tells agents which playbook to read at each stage and what evidence to leave behind.

If a step conflicts with a more specific playbook, follow the more specific playbook and update this map if the workflow changed.

## 1. Capture the Idea

Start by turning the request into a small, testable outcome:

- name the user-facing change or maintainer problem
- list acceptance criteria for behavior, docs, and safety
- identify whether the change is CLI/package, server/security, client/UI, docs/process, or release work
- decide whether the work needs a plan in `docs/plans/`

Use `docs/agents/WORKFLOW.md` for the default development loop and `docs/agents/ARCHITECTURE.md` for system boundaries.

## 2. Orient the Workspace

Before editing:

```bash
git status -sb
rg --files -g '!*node_modules*' -g '!*.comments.md'
```

Then read the nearest source, tests, and docs for the change. Preserve unrelated dirty work and do not edit protected user/session files.

Use `docs/agents/START_HERE.md` for orientation and `docs/agents/QUALITY_GATES.md` to pick the first verification target.

## 3. Plan the Change

For multi-file work, write a short practical plan in the conversation:

- files or boundaries to inspect
- files likely to change
- tests or docs likely to change
- verification command to run first

Keep the plan small enough to change as the code teaches you more.

## 4. Implement in Small Steps

Make the smallest coherent change that satisfies the acceptance criteria:

- follow the existing plain Node.js ESM style
- keep source HTML and Markdown untouched by the annotation layer
- add or update tests close to changed behavior
- update README, CHANGELOG, Mintlify docs, examples, or playbooks when behavior or process changes
- treat tunnel sharing, file serving, auth, hooks, local agents, and publishing as security-sensitive

Use `docs/agents/SECURITY_REVIEW.md` whenever the change touches trust boundaries.

## 5. Verify Locally

Run the smallest relevant gate while developing, then the full gate before handoff:

```bash
npm run check
npm run agent:check
npm run docs:check
npm test
npm run smoke:check
npm run ci
```

For package or release-path changes, also run:

```bash
npm run pack:check
```

Do not handwave failed or skipped checks. Name the failure, the likely cause, and the next command or fix.

## 6. Review and Prepare the PR

Before a PR:

- inspect the diff for unrelated churn
- confirm docs and tests match behavior
- check `CHANGELOG.md` for user-visible changes
- run the relevant quality gate and usually `npm run ci`
- summarize implementation, verification, security/package/docs impact, and residual risk

All changes to `main` go through pull requests. Push a branch, open a PR, wait for CI, resolve review conversations, and squash merge through GitHub.

Use `/tunelito-pr` for PR summaries and `/tunelito-ship` when the user explicitly asks to commit, push, or open a PR.

## 7. Prepare a Versioned Release

Version changes happen in a PR before a release is created. Keep these in sync:

- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `docs/RELEASING.md`

Run:

```bash
npm run release:check -- <version-or-tag>
npm run ci
npm run pack:check
```

Use npm-valid semver prereleases such as `0.6.3-rc.0` or `0.6.3-beta.0`.

Use `docs/agents/RELEASE_PLAYBOOK.md` for release readiness and `docs/RELEASING.md` for the public npm release process.

## 8. Draft and Publish

After the version PR is merged to `main`, create a draft GitHub Release:

```bash
gh workflow run "Draft Release" -f version=<version>
```

Review the generated notes. Publishing the GitHub Release triggers the `Publish Package` workflow, which publishes to npm through trusted publishing.

Do not publish from a local shell. The Claude hook blocks direct `npm publish` because releases should go through GitHub trusted publishing.

## 9. Verify the Published Package

After the publish workflow completes, verify the public install path from a clean directory outside the `tunelito` source package:

```bash
cd /tmp
npx --yes tunelito --version
printf '<!doctype html><h1>Tunelito smoke</h1>' > tunelito-smoke.html
npx --yes tunelito ./tunelito-smoke.html --no-tunnel
```

If public install fails, fix that before calling the release ready.

## 10. Compound the Learning

When a non-obvious workflow issue is solved, codify it:

- update the relevant playbook
- add a validator check when the convention is important enough to enforce
- add a `docs/solutions/` postmortem when the failure mode is likely to recur

The goal is that the next agent can move from idea to release by reading files in the repo, not by inheriting chat history.
