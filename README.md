# Tunelito

[![CI](https://github.com/chekos/tunelito/actions/workflows/ci.yml/badge.svg)](https://github.com/chekos/tunelito/actions/workflows/ci.yml)

Tunelito turns any local HTML file into a temporary live review room.

Run one command, share the printed URL on a call, and reviewers can select text on the page to leave live comments. You keep editing the HTML in your normal editor; connected browsers reload when the file changes. Comments are saved as readable markdown beside the page by default, or kept ephemeral with `--live`.

Tunelito is local-first: your file stays on your machine, the public URL is a temporary tunnel to your laptop, and edit access never leaves your editor.

## Quickstart

Tunelito requires Node.js 22 or newer.

```bash
npx --yes tunelito ./page.html
```

From a clone:

```bash
npm install
npm link
tunelito ./examples/simple-review.html
```

Tunelito prints:

```text
Tunelito is running
Local:   http://127.0.0.1:4317/?tunelito_key=...
Comments: /path/to/page.comments.md
Access:  review key required by the printed URLs
Public:  https://example.trycloudflare.com/?tunelito_key=...
```

Share the `Public:` URL with the person on your call. Open the `Local:` URL yourself if you want to watch the same session.

For local-only work:

```bash
tunelito ./page.html --no-tunnel --open
```

For in-meeting collaboration without writing comments to disk:

```bash
tunelito ./page.html --live
```

## What Reviewers Can Do

- Select text on desktop or mobile.
- Tap `Comment` and leave a note.
- See other comments appear live.
- In `--live`, see peer cursors and live selection highlights when the browser can connect peer-to-peer.
- In persistent sessions, open the generated markdown comments file from the panel.

## What You Control

- The source HTML file remains untouched.
- Edits happen in your editor only.
- Saved HTML changes trigger a live reload in connected browsers.
- Comments persist to `<page>.comments.md` unless you choose another path with `--out`.
- `--live` keeps comments in memory only; the session disappears when the local server exits.

## CLI

```text
Tunelito 0.2.0

Usage: tunelito <page.html> [options]

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page>.comments.md)
  --live                Use ephemeral live collaboration mode; do not write comments to disk
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --no-auth             Disable the generated review-key URL gate
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show this help
```

## How It Works

Tunelito serves the HTML from disk and injects a small same-origin annotation client into the response. The injected client handles selection, comment composition, highlights, live sync, and reload notices. The original HTML file is not modified.

The server also:

- serves sibling assets relative to the HTML file
- writes comments to markdown atomically
- restores prior comments from hidden Tunelito metadata in that markdown
- relays WebRTC signaling and live fallback events in `--live`
- starts `cloudflared tunnel --url <local-url>` when available
- falls back to `npx cloudflared@latest` when `cloudflared` is not installed

Set `TUNELITO_CLOUDFLARED_PACKAGE=cloudflared@<version>` to pin the fallback package used by `npx` while keeping the default behavior on `cloudflared@latest`.

## Access Model

Shared sessions include a generated `tunelito_key` in the printed URLs by default. The key is bearer access: anyone with the full URL can view the page and leave comments. The first valid request sets a short-lived, HTTP-only cookie so page assets and WebSocket sync keep working.

Use `--no-auth` only for local demos or trusted networks. For sensitive material, prefer `--no-tunnel` or avoid sharing the session link.

## Comment Files

By default:

```text
page.html
page.comments.md
```

The markdown is meant to be readable in any editor:

```markdown
# Tunelito comments for `page.html`

## Jane at 2026-05-22 18:00:00 UTC

> selected text

This sentence needs a clearer verb.
```

Tunelito also stores hidden metadata comments so the live session can be restored after a restart.

In `--live`, comments are not written to markdown and are not restored after restart.

## Live Mode

`--live` is for in-the-meeting collaboration. Comments, cursors, and selection highlights stay in memory and disappear when the local server exits.

Tunelito uses WebRTC data channels between browsers when possible. The authenticated WebSocket connection remains open for room membership, WebRTC signaling, file-change reloads, and fallback relay if a peer-to-peer connection cannot be established. Tunelito does not configure third-party STUN or TURN servers, so some remote networks will use the relay fallback.

## Pre-call Checklist

Before sharing a live session:

1. Run `npx --yes tunelito ./page.html`.
2. Wait for the `Public:` URL.
3. Open that URL on your phone.
4. Select text and submit a short comment.
5. Confirm the terminal logs `Comment from ...`.
6. Confirm `<page>.comments.md` contains the comment.
7. Edit and save the HTML file; the phone should reload.

For an ephemeral call, run with `--live` and skip the markdown-file check.

## Packaging a Release Tarball

```bash
npm run ci
npm pack
npm install -g ./tunelito-0.2.0.tgz
```

The package includes the CLI, runtime source, examples, docs, changelog, license, and security policy.

## Project Docs

- [Security policy](./SECURITY.md)
- [Release process](./docs/RELEASING.md)
- [Agent playbooks](./docs/agents/START_HERE.md)
- [Mintlify docs source](./docs-site/README.md)
- [Examples](./examples/README.md)

## Current Limits

- Text annotations work best on real DOM text.
- Canvas, video, images, and cross-origin iframes are not yet annotatable.
- If the exact commented text changes, the comment remains in markdown and the sidebar, but the highlight may not reattach.
- Strict in-page CSP meta tags are removed from the served response so the injected same-origin client can run.
- WebRTC peer-to-peer connections depend on browser and network support; the WebSocket relay keeps `--live` usable when direct peer connections fail.
