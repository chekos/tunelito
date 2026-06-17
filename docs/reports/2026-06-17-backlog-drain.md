# Backlog Drain Report

Started: 2026-06-17 Pacific / 2026-06-18 UTC

## Baseline

- Branch: `codex/backlog-drain-2026-06-17` from up-to-date `origin/main`.
- Open GitHub issues at start: #49, #50, #51, #52, #53.
- Priority order: #49 major foundational, #52 major security, #50 major security, #51 major workflow/UI, #53 minor onboarding/docs. No open issue had a `critical`, `major`, or `minor` label, so this ordering is based on security sensitivity, dependency order, and product impact.
- Binding instructions read: `AGENTS.md`, `CLAUDE.md`, `docs/agents/START_HERE.md`, `docs/agents/IDEA_TO_RELEASE.md`, `docs/agents/WORKFLOW.md`, `docs/agents/QUALITY_GATES.md`, `docs/agents/ARCHITECTURE.md`, `docs/agents/RELEASE_PLAYBOOK.md`, `docs/RELEASING.md`, and `docs/agents/EXAMPLE_FIXTURES.md`.
- `STRATEGY.md` was requested as binding input but is not present in this checkout.
- Protected local artifacts present and left untouched: `.env`, `videos/`.

## Baseline Verification

- `npm run check` passed.

## Issue #49: Add a first-class Tunelito comments index and JSON schema

Status: implemented, verified, committed, and closed. The exact commit SHA is recorded on GitHub issue #49.

Priority: major foundational, because #50 MCP and #52 doctor both need a structured comments index instead of scraping `*.comments.md`.

Decision:

- Use `tunelito comments inspect` as the CLI surface.
- Keep `*.comments.md` as the durable, human-readable inbox and expose JSON only as a derived integration view.
- Reuse the existing hidden metadata restoration path rather than parsing visible Markdown.
- Treat a missing default comments file for an existing target as an empty successful index, matching current inbox behavior.
- Treat direct inspection of a missing or unrecognized comments Markdown file as an error with diagnostics.
- Leave agent ledger status out of this first index; that belongs to `inbox status --format json` and later MCP/doctor surfaces.

What changed:

- `src/comment-index.js`: added the versioned `tunelito-comments` index builder, summary counts, normalized comment output, and diagnostics for missing, empty, unrecognized, or damaged comments files.
- `src/comments.js`: refactored markdown restoration behind a diagnostic-capable inspector while keeping normal runtime loading tolerant of stale or hand-edited metadata.
- `bin/tunelito.js`: added `tunelito comments inspect <page.html|folder|comments.md> --json`, help text, text output, and CLI parsing for default, `--out`, and direct markdown inspection.
- `docs/spec/tunelito-comments.md` and `docs/spec/tunelito-comments.schema.json`: documented the JSON contract and schema.
- `README.md`, `docs-site/cli.mdx`, `docs-site/comments.mdx`, `docs-site/how-it-works.mdx`, `docs/agents/ARCHITECTURE.md`, `docs/agents/QUALITY_GATES.md`, `CHANGELOG.md`: documented the new derived index surface and kept the Markdown inbox as the durable source of truth.
- `package.json`: added `docs/spec/` to the npm package allowlist so the schema/spec ship with the tarball.
- `test/comments.test.js` and `test/cli.test.js`: added coverage for single-file and folder defaults, custom `--out`, direct Markdown inspection, owner-approved counts, rendered empty inboxes, missing default/direct files, CRLF files, visible metadata spoofing, damaged hidden metadata, visible-only files, and command-level JSON output.

Verification:

- `npm run check` passed.
- `node --test test/comments.test.js test/cli.test.js` passed: 62 tests.
- `npm run docs:check` passed.
- `npm run pack:check` passed.
- `node bin/tunelito.js comments inspect examples/simple-review.html --json` passed and returned an empty successful index with an informational missing-file diagnostic.
- `npm run ci` passed: check, agent config, docs check, 129 tests, smoke check, and package smoke check.
- Multi-agent adversarial verification ran in two passes. Persistence/security review was clean. Contract/docs review found two issues: direct empty or visible-only Markdown files could look like clean empty indexes, and command-level coverage for `--out`/direct success was thin. Both were fixed and the contract reviewer re-check reported no remaining blockers.
- No UI changed, so the `visual-qa-hig` equivalent was not applicable for this issue.

## Issue #52: Add tunelito doctor for local setup, inbox, tunnel, and safety diagnostics

Status: implemented, verified, committed, and closed. The exact commit SHA is recorded on GitHub issue #52.

Priority: major security, because it diagnoses auth/tunnel exposure, agent ledger health, comments inbox parsing, and local setup without starting a session.

Decision:

- Added a read-only `tunelito doctor` command instead of folding diagnostics into the server-start path.
- Implemented runtime, target, comments index, agent state, host/port, tunnel availability, and safety checks in one report.
- Kept JSON as the stable agent/tool surface with `format: "tunelito-doctor"` and `version: 1`; text output is a human summary.
- Reused the #49 comments index for comments diagnostics and `loadAgentState` for ledger parsing.
- Treated `--no-auth` with tunnel enabled, non-loopback hosts, and agent-input trust as warnings; treated `--live` with agent workflows as an error because it conflicts with persistent inbox requirements.
- Chose a non-binding port availability heuristic using `lsof` with a timeout. A first implementation briefly opened a TCP listener to test availability; adversarial review caught that as a read-only violation, so it was replaced. If a non-binding check cannot determine availability, doctor warns instead of binding.
- Kept `doctor` from starting a Tunelito server, tunnel, browser, package install, or repair action.

What changed:

- `src/doctor.js`: added report assembly and diagnostic checks.
- `bin/tunelito.js`: added `doctor` routing, argument parsing, JSON/text output, and top-level help.
- `test/doctor.test.js`: covered runtime-only diagnostics, valid file/folder targets, custom comments path, damaged comments files, invalid agent state JSON, safety warnings, unavailable/unknown port checks, and read-only behavior.
- `test/cli.test.js`: covered doctor argument parsing and JSON/exit-code behavior.
- README, Mintlify CLI docs, `docs/agents/START_HERE.md`, `docs/agents/SECURITY_REVIEW.md`, `docs/agents/ARCHITECTURE.md`, `docs/agents/QUALITY_GATES.md`, bundled `docs-site/skill.md`, and `CHANGELOG.md` document the new read-only diagnostic path.

Verification:

- `npm run check` passed.
- `node --test test/doctor.test.js test/cli.test.js` passed: 50 tests.
- `node bin/tunelito.js doctor examples/simple-review.html --json --no-tunnel` passed with runtime, target, comments, agent-state, port, and no-tunnel diagnostics.
- `npm run docs:check` passed.
- `npm run pack:check` passed.
- `npm run ci` passed: check, agent config, docs check, 139 tests, smoke check, and package smoke check.
- Multi-agent adversarial verification ran in two passes. The docs/acceptance reviewer was clean. The security/read-only reviewer found the TCP listener problem in the initial port check; after replacement with a non-binding `lsof` heuristic, the re-check reported no remaining read-only/security blockers.
- No UI changed, so the `visual-qa-hig` equivalent was not applicable for this issue.
