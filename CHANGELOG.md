# Changelog

## Unreleased

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
