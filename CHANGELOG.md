# Changelog

## Unreleased

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
