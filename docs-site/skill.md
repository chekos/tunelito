---
name: tunelito
description: Use Tunelito to serve local HTML as a temporary live review room with comments. Use when a user wants to review, annotate, or share an HTML page or folder from their machine.
license: MIT
compatibility: Requires Node.js 22 or newer. Public sharing uses Cloudflare Tunnel when available.
metadata:
  package: tunelito
  install: npx --yes tunelito ./page.html
---

# Tunelito

Tunelito turns a local HTML file or folder of HTML files into a temporary live review room. The user can edit the files locally. Reviewers can view served pages, leave comments on selected text, add page notes, or add site-wide notes.

## Capabilities

- Serve one local HTML file or a folder of HTML files.
- Inject a live comment UI into the served response without modifying the source file.
- Sync comments over WebSocket, with WebRTC peer-to-peer collaboration in `--live`.
- Persist comments to Markdown by default, or keep them ephemeral with `--live`.
- Include scopes, page paths, and comment IDs in Markdown for agent inbox workflows.
- Run an opt-in local agent worker with Codex, Claude Code, or a custom CLI.
- Track resolved/no-op/blocked/stale comments in `.tunelito/agent/state.json` to avoid repeated edits.
- Reload connected browsers when source HTML changes.
- Expose the local server through a temporary Cloudflare Tunnel.
- Require keyed review URLs by default.

## Start a review

```bash
npx --yes tunelito ./page.html
```

Share the printed `Public:` URL.

For a folder-backed mini-site:

```bash
npx --yes tunelito ./site
```

For unattended local agent follow-up with Codex:

```bash
npx --yes tunelito ./site --agent codex
```

For Claude Code:

```bash
npx --yes tunelito ./site --agent claude
```

## Local-only review

```bash
tunelito ./page.html --no-tunnel --open
```

## Constraints

- Do not use Tunelito as permanent hosting.
- Do not share sensitive material unless the user accepts bearer-link exposure.
- Do not enable `--agent` for untrusted reviewers; comments become local agent input. Use `--agent-trigger "@agent"` when stricter gating is needed.
- Do not use `--agent` with `--live`; live comments are ephemeral and cannot be polled.
- Canvas, video, images, and cross-origin iframes are not yet annotatable.
- Comments remain readable in Markdown even if highlights cannot reattach after text edits.
