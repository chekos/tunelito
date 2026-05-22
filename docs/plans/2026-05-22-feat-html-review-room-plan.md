---
title: "feat: Add HTML review room CLI"
type: feat
status: active
date: 2026-05-22
---

# feat: Add HTML Review Room CLI

Build Tunelito as a local-first CLI that serves any HTML file as a temporary collaborative review room. The HTML file remains untouched; Tunelito injects the comment layer at response time.

## Acceptance Criteria

- [x] A single command starts a local server for a provided HTML file.
- [x] Served HTML includes an injected annotation client without modifying the source file.
- [x] Reviewers can select DOM text and leave comments.
- [x] Comments sync live to connected browsers.
- [x] Comments persist to a sibling markdown file.
- [x] Existing comment markdown restores live session state after restart.
- [x] Connected browsers reload when the source HTML changes on disk.
- [x] Sibling static assets load relative to the reviewed HTML file.
- [x] CLI can optionally start a Cloudflare quick tunnel.
- [x] Tests cover injection, persistence, and live comment flow.
- [x] README documents usage, options, and limits.

## Implementation Notes

- Use Node built-ins only for the first version.
- Use WebSocket rather than SSE because tunnel compatibility is better for this use case.
- Keep the injected UI isolated with Shadow DOM and a neutral visual style.
- Store robust text anchors with quote, prefix, suffix, text offsets, and CSS path.
- Use hidden metadata in markdown so the file remains readable while still allowing restart restore.

## Verification

- Run `npm test`.
- Run `npm run check`.
- Smoke test the CLI against the included HTML page with `--no-tunnel`.
