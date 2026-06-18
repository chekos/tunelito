# Changelog

## Unreleased

- Adds `tunelito mcp`, a stdio MCP adapter for comments index, pending feedback, claim, watch, record, and inbox status tools.
- Adds `tunelito doctor`, a read-only diagnostic command for local setup, comments inbox health, agent ledger JSON, ports, tunnel availability, and safety warnings.
- Adds `tunelito comments inspect`, a versioned JSON comments index for agents and diagnostics that derives from the existing Markdown inbox.

## 0.13.0 - 2026-06-17

- Adds owner approval for visitor comments, letting owner-keyed sessions approve a specific visitor comment for local-agent work without rewriting it as an owner comment.
- Replaces `Guest <code>` reviewer names with friendly assigned names and lets reviewers rename prior comments tied to the same reviewer identity.
- Adds a default-off presenter pointer halo for fine-pointer devices, with ephemeral peer broadcast in `--live`.

## 0.12.0 - 2026-06-12

- Adds browser-visible agent work status on comment cards, plus `tunelito inbox status` as the matching terminal tracker. Reviewers can see queued, in-progress, follow-up, and integrated feedback directly in the Tunelito panel.

## 0.11.0 - 2026-06-10

- Makes `--agent-session` watch and claim comments from the serving process, so current-agent review sessions start with one command instead of a separate `inbox watch` step.

## 0.10.1 - 2026-06-10

- Simplifies shared local-agent and active-agent inbox configuration normalization without changing CLI behavior.
- Adds direct regression coverage for agent config validation order and trigger defaults.

## 0.10.0 - 2026-06-10

- Adds active-agent inbox commands: `tunelito inbox next`, `tunelito inbox watch`, and `tunelito inbox record` let the current Claude Code, Codex, or other agent session claim and resolve Tunelito comments without spawning a nested worker.
- Guards active-agent recordings with claim ids, so `inbox watch` prints the exact `inbox record --claim ...` command for the current lease.
- Adds `--agent-session`, which prints inbox commands and writes `.tunelito/session.json` for current-agent comment watching while preserving the existing `--agent` worker path for unattended auto-apply sessions.

## 0.9.0 - 2026-06-09

- Adds `tunelito skill show`, which prints the distributable Tunelito agent skill (SKILL.md) so a coding agent can install it (for example `tunelito skill show > .claude/skills/tunelito/SKILL.md`).
- Rewrites the distributable agent skill into a start → share → process → wrap-up guide covering the comment Markdown schema, the `--agent` worker, and applying a `*.comments.md` inbox by hand.
- Documents that `--no-auth` does not disable the tunnel (a tunneled `--no-auth` session is a public, ungated URL) and that `--live` changes persistence, not exposure.

## 0.8.1 - 2026-06-08

- Keeps single-file live reload working after repeated atomic-save edits by watching the parent directory and filtering for the served HTML file.
- Keeps the floating comment composer visible near the bottom of the viewport by flipping or clamping it on desktop while preserving the mobile bottom-sheet layout.

## 0.8.0 - 2026-06-08

- Adds `--agent-policy` for deterministic local-agent comment gating by all comments, trigger mentions, owner comments, or owner-or-mention sessions.
- Wakes the local agent worker when the persistent comments markdown changes, while keeping interval polling as a fallback.

## 0.7.0 - 2026-06-08

- Adds random editable reviewer names and `--owner <name>` so local owner comments are labeled for humans and local agent prompts.

## 0.6.3 - 2026-06-05

- Prevents visible reviewer text that looks like Tunelito metadata from being restored as an extra hidden comment.
- Closes malformed WebSocket frames without taking down the local review server.
- Keeps client injection working when the served HTML mentions `/__tunelito/client.js` as ordinary page text.
- Rejects partial numeric CLI option values such as `--port 4317junk`.

## 0.6.2 - 2026-05-28

- Makes the injected comments launcher less disruptive on mobile by replacing the large bottom pill with a compact icon button and count badge above common bottom navigation.

## 0.6.1 - 2026-05-28

- Preserves saved `needs_followup` continuation context after retryable local-agent failures so retries still receive completed and remaining tasks.

## 0.6.0 - 2026-05-28

- Adds multi-pass local agent continuations: agents can return `needs_followup` for any inline, page, or site comment, Tunelito carries completed and remaining tasks into the next prompt, and `--agent-max-passes` bounds broad work.
- Separates failed-run retries from continuation passes and stops follow-up loops that report no observable progress.

## 0.5.0 - 2026-05-28

- Adds page notes and site-wide comments: reviewers can now leave unanchored feedback, folder sessions show site comments on every page, and the local agent worker receives comment scope in its prompt and retry fingerprint.
- Adds an automated package smoke check that proves the packed tarball exposes a runnable `tunelito` CLI through global install and `npx --package`.

## 0.4.1

- Makes the local agent worker evaluate all persistent comments by default, with `--agent-trigger` still available for marker-gated sessions.
- Adds `--agent-instructions`, `--agent-instructions-file`, `--agent-prompt`, and `--agent-prompt-file` for appending host guidance or replacing the built-in worker behavior prompt.
- Updates the worker prompt so agents can mark non-actionable comments `ignored` instead of requiring every comment to become an edit.

## 0.4.0

- Adds an opt-in local agent worker that can poll persistent comments and invoke Codex, Claude Code, or a custom local CLI to edit the matching HTML files.
- Adds a durable `.tunelito/agent/state.json` resolution ledger so handled comments are not retried after source edits make their highlights stale.
- Documents the on-the-go folder review workflow, provider options, status states, and local agent guardrails.

## 0.3.1

- Adds a dedicated folder review tutorial and links it from the quickstart, comments docs, docs landing page, and README.

## 0.3.0

- Adds folder targets so `tunelito ./site` serves a folder of HTML files, injects review UI into served HTML pages, and keeps one page-aware comments inbox.
- Shows visible page paths and comment IDs in comment markdown for coding-agent inbox workflows.

## 0.2.0

- Adds `--live` for ephemeral in-meeting collaboration without writing comments to disk.
- Adds WebRTC peer signaling and browser data channels for live cursors, selection highlights, and instant comment fanout, with the existing WebSocket room as the authenticated fallback relay.
- Keeps persistent Markdown comment sessions as the default workflow.
- Added a local release doctor, lightweight CLI smoke check, and a configurable Cloudflare Tunnel fallback package for deterministic hardening.

## 0.1.1

- Publishes Tunelito to npm so reviewers can start with `npx --yes tunelito ./page.html`.
- Promotes the package docs from GitHub installation to npm-first usage.
- Configures npm trusted publishing for GitHub Actions and skips already-published versions in the release workflow.
- Rolls up the 0.1.1 prerelease work: review-key URLs, Node.js 22+ support, CI/trusted-publishing scaffolding, security/release docs, mobile text selection, package metadata, and the bundled smoke-test example.

## 0.1.1-beta.2

- Keeps GitHub installs clean by relying on explicit CI/release checks instead of a `prepack` hook.

## 0.1.1-beta.1

- Raises the supported runtime to active LTS Node.js 22+.
- Adds generated review-key URLs for shared sessions by default.
- Adds CI across Node.js 22, 24, and 26.
- Adds trusted-publishing release workflow scaffolding.
- Adds security and release documentation.
- Polishes the README for beta testers.

## 0.1.1-beta.0

- Adds beta package metadata for GitHub/tarball installs.
- Adds mobile text-selection support for the injected annotation flow.
- Adds a clean example page for smoke tests and beta demos.
- Adds package dry-run validation and tarball install smoke coverage to the release process.

## 0.1.0

- Adds the initial Tunelito CLI, local server, injected comment layer, WebSocket sync, markdown persistence, file-watch reloads, and optional Cloudflare Tunnel sharing.
