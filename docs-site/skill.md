---
name: tunelito
description: Use Tunelito to serve a local HTML file as a temporary live review room with comments. Use when a user wants to review, annotate, or share an HTML page from their machine.
license: MIT
compatibility: Requires Node.js 22 or newer. Public sharing uses Cloudflare Tunnel when available.
metadata:
  package: tunelito
  install: npm install -g github:chekos/tunelito
---

# Tunelito

Tunelito turns a local HTML file into a temporary live review room. The user can edit the file locally. Reviewers can view the served page and leave comments on selected text.

## Capabilities

- Serve one local HTML file.
- Inject a live comment UI into the served response without modifying the source file.
- Sync comments over WebSocket.
- Persist comments to Markdown.
- Reload connected browsers when the source HTML changes.
- Expose the local server through a temporary Cloudflare Tunnel.
- Require keyed review URLs by default.

## Start a review

```bash
tunelito ./page.html
```

Share the printed `Public:` URL.

## Local-only review

```bash
tunelito ./page.html --no-tunnel --open
```

## Constraints

- Do not use Tunelito as permanent hosting.
- Do not share sensitive material unless the user accepts bearer-link exposure.
- Canvas, video, images, and cross-origin iframes are not yet annotatable.
- Comments remain readable in Markdown even if highlights cannot reattach after text edits.
