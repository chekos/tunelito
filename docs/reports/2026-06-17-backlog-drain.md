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

## Issue #50: Expose comments and inbox workflows through stdio MCP tools

Status: implemented, verified, committed, and closed. The exact commit SHA is recorded on GitHub issue #50.

Priority: major security, because MCP exposes reviewer-authored comments to coding agents and must preserve Tunelito's local-first persistence and tool boundaries.

Decision:

- Added `tunelito mcp` as a stdio adapter over existing comments-index and active-agent inbox primitives.
- Used current MCP newline-delimited JSON-RPC over stdio for output. The adapter also accepts legacy `Content-Length` framed input so older clients can still talk to it, but it does not advertise the older framing as the primary contract.
- Exposed six tools: comments index, pending feedback, claim next comment, watch next comment, record comment result, and inbox status.
- Kept read-only tools read-only. Claim tools write only the existing `.tunelito/agent/state.json` ledger. Record writes the ledger and appends the existing `.tunelito/agent/log.md` run log, matching `tunelito inbox record`.
- Required inbox tools validate `targetPath` before deriving or reading comments/state paths. The lower-level comments-index tool remains useful with an explicit comments file.
- Returned structured MCP content while also including text JSON for clients that only render `content`.
- Rejected invalid tool calls with integer JSON-RPC error codes instead of leaking Node string error codes such as `ENOENT`.
- Documented reviewer comments returned through MCP as untrusted input and kept MCP from starting a review server, Cloudflare Tunnel, browser, local agent worker, editor, or package install.

What changed:

- `src/mcp.js`: added the MCP server, newline and `Content-Length` parsers, JSON-RPC request handling, tool schemas, strict inbox target validation, and tool implementations over the existing comments/index/inbox primitives.
- `bin/tunelito.js`: added `tunelito mcp`, top-level help, and side-effect-free help/error handling for the MCP command.
- `test/mcp.test.js`: covered initialize/tools list, parser compatibility, comments-index structured content, pending feedback read-only behavior, claim/record claim semantics, record log disclosure, invalid-target JSON-RPC errors, inbox status, watch timeout, and unknown tool errors.
- `test/cli.test.js`: covered MCP help and unknown-argument behavior.
- `README.md`, `docs-site/cli.mdx`, `docs-site/agent-worker.mdx`, `docs-site/skill.md`, `docs/agents/ARCHITECTURE.md`, `docs/agents/SECURITY_REVIEW.md`, `docs/agents/QUALITY_GATES.md`, and `CHANGELOG.md`: documented the MCP surface, quality gate, persistence boundaries, and security posture.

Verification:

- `npm run check` passed.
- `node --test test/mcp.test.js test/cli.test.js test/agent-worker.test.js` passed: 77 tests.
- `npm run docs:check` passed.
- `npm run pack:check` passed.
- `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node bin/tunelito.js mcp` passed and returned one JSON-RPC line with the six MCP tools and no extra stdout output.
- `npm run ci` passed: check, agent config, docs check, 149 tests, smoke check, and package smoke check.
- `git diff --check` passed.
- Multi-agent adversarial verification ran in two passes. The first security/persistence reviewer found three issues: record side effects needed to disclose the existing log append, required inbox tools needed target validation before derived comments/state reads, and more tool descriptions needed untrusted-input warnings. The first protocol/docs reviewer also found the string `ENOENT` JSON-RPC code problem. All were fixed with code, docs, and tests. The re-check from both reviewers reported clean: no security/persistence blockers, no MCP protocol/docs blockers, and no path that starts a server, tunnel, browser, worker, editor, or HTML edit.
- No UI changed, so the `visual-qa-hig` equivalent was not applicable for this issue.

## Issue #51: Add an explicit Done Reviewing handoff event for review sessions

Status: implemented, verified, committed, and closed. The exact commit SHA is recorded on GitHub issue #51.

Priority: major workflow/UI, because review-call users need an explicit batch-finished signal before an agent starts work.

Decision:

- Added a browser `Done Reviewing` action and a server-side in-memory `review.completed` event queue.
- Kept the v1 handoff event ephemeral and session-scoped. It is retained only while the server process is running and does not survive restart.
- Implemented `tunelito review watch` as the CLI wait primitive. It can wait against a printed `--url`, or use `.tunelito/session.json` metadata when an active-agent session has written a review URL.
- Chose replay-after-zero as the default so a CLI waiter started just after the reviewer clicks still receives the retained event. `--after latest` intentionally waits only for future events, and `--after <sequence>` continues from a known event.
- Included sequence, timestamp, target path, persistent comments path when available, live/directory mode flags, summary counts, optional event-only overall comment, and reviewer metadata in the event.
- Kept overall comments event-only for v1. No persistent handoff note is written as a page/site comment.
- Did not add `--agent-session --wait-for-review-complete` in this slice. The core event and wait command are complete, and automatic claiming after handoff is a larger product surface.
- Kept existing incremental flows intact: `--agent`, `--agent-session`, `tunelito inbox watch`, and MCP inbox tools continue to work independently.

What changed:

- `src/server.js`: added the review handoff queue, WebSocket `review-completed` handling, protected `/__tunelito/review-events` wait route, timeout handling, retained replay, and summary generation.
- `src/client.js`: added the `Done Reviewing` panel action and acknowledged `Sent #<sequence>` state.
- `src/inject.js`: exported the review-events route constant.
- `bin/tunelito.js`: added `tunelito review watch`, top-level help, text/JSON output, timeout/after options, server-printed handoff command, and `.tunelito/session.json` review URL metadata.
- `test/server.test.js`: covered WebSocket handoff events, CLI-visible waits, increasing sequences, retained replay, timeout, persistent comments markdown safety, source HTML safety, live-mode handoff without comments-file writes, and injected client coverage for the control.
- `test/cli.test.js`: covered review command parsing, URL/query preservation, JSON output, session metadata discovery, timeout exit codes, and format validation.
- `README.md`, `docs-site/cli.mdx`, `docs-site/agent-worker.mdx`, `docs-site/skill.md`, `docs/agents/ARCHITECTURE.md`, `docs/agents/QUALITY_GATES.md`, `docs/agents/SECURITY_REVIEW.md`, and `CHANGELOG.md`: documented the handoff workflow, replay semantics, live-mode ephemerality, security boundary, and quality gate.

Verification:

- `npm run check` passed.
- `node --test test/server.test.js test/cli.test.js` passed: 66 tests.
- `npm run docs:check` passed.
- Browser visual/HIG QA passed on `examples/project-brief.html` at desktop `1440x1000` and mobile `390x844`: the button fit, acknowledged as `Sent #1`, no horizontal overflow was measured, mobile button height was 44px, and no text/control overlap was visible. The only console error was the fixture's existing missing `favicon.ico` 404.
- Real CLI wait passed against a live local server: `node bin/tunelito.js review watch --url http://127.0.0.1:4317/ --json --timeout 1` returned the retained `review.completed` payload.
- `npm run ci` passed: check, agent config, docs check, 153 tests, smoke check, and package smoke check.
- `git diff --check` passed.
- Multi-agent adversarial verification was clean. The security/persistence reviewer confirmed route auth, timeout behavior, no durable event writes, no comments/source corruption, and no server/tunnel/browser/worker/editor spawn from `review watch`. The UI/docs reviewer confirmed the browser action, acknowledged state, desktop/mobile layout probes, CLI replay, docs coverage, and no leftover QA artifacts.

## Issue #53: Improve agent setup UX with guided cross-agent onboarding

Status: implemented, verified, committed, and closed. The exact commit SHA is recorded on GitHub issue #53.

Priority: minor onboarding/docs, because the existing `skill show` primitive worked but needed clearer setup guidance for multiple agent products.

Decision:

- Kept `tunelito skill show` unchanged as the stable source of truth for the bundled skill body.
- Added `tunelito skill setup` under the existing `skill` namespace instead of adding a top-level `agent` command. That avoids reserving `agent` as a command and preserves the ability to serve a folder literally named `agent`.
- Made setup v1 no-write: it prints guidance only and does not create files, install packages, edit global instructions, or create symlinks.
- Included Claude Code project-skill commands, Codex/instruction-file guidance without assuming one global path, Cursor/Gemini/opencode/Copilot-style guidance, and explicit warnings to inspect existing instruction files before editing.
- Included tunnel safety guidance: `--no-auth` is not local-only, and sensitive pages should use `--no-tunnel`, optionally with `--live`.
- Added linkable hosted docs at `/agent-setup` and kept docs hierarchy explicit: `skill show` is the skill body, `skill setup` is usage guidance, hosted docs are linkable human/agent guidance, automatic global edits are not part of v1.

What changed:

- `bin/tunelito.js`: added `tunelito skill setup`, top-level/skill help text updates, and no-write onboarding output with version and Node 22 runtime requirement.
- `test/cli.test.js`: added coverage that setup exits 0, prints the expected onboarding guidance, and leaves a fresh temp directory unchanged.
- `docs-site/agent-setup.mdx`: added the hosted setup guide.
- `docs-site/docs.json`: added the setup guide to docs navigation.
- `README.md` and `docs-site/cli.mdx`: documented `skill setup` near the agent skill and CLI surfaces.
- `docs/agents/SKILLS.md`: documented the public setup surface and stable `skill show` hierarchy.
- `scripts/package-smoke-check.mjs`: added a tarball-installed `tunelito skill setup` assertion so setup guidance ships in the npm package.
- `CHANGELOG.md`: recorded the user-facing setup command.

Verification:

- `npm run check` passed.
- `node --test test/cli.test.js` passed: 46 tests.
- `npm run docs:check` passed.
- `npm run pack:check` passed.
- `node bin/tunelito.js skill setup` printed the expected no-write setup guide.
- `npm run ci` passed: check, agent config, docs check, 154 tests, smoke check, and package smoke check.
- `git diff --check` passed.
- Multi-agent adversarial verification found one blocker: setup initially said Node.js 20 or newer, while the package requires Node.js 22 or newer. The CLI output and hosted docs were corrected to Node.js 22, focused checks were rerun, and the re-check reported clean with no remaining CLI/docs/package blockers.
