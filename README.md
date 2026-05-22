# Tunelito

Tunelito turns any local HTML file into a temporary live review room.

You run one command, share the local or tunnel URL on a call, and reviewers can select text on the page to leave live comments. Your HTML file stays the source of truth: edit it in your normal editor, save, and connected browsers reload.

Tunelito is local-first. The public URL is a temporary tunnel to your laptop, and comments are written to a markdown file beside the HTML page.

## Quick Start

From a clone:

```bash
npm install
npm link
tunelito ./examples/simple-review.html
```

For a friend testing the beta from GitHub:

```bash
npm install -g github:chekos/tunelito
tunelito ./page.html
```

For local-only testing:

```bash
tunelito ./page.html --no-tunnel --open
```

Tunelito prints:

- a local URL
- a public Cloudflare Tunnel URL when `cloudflared` is installed, or when `npx cloudflared@latest` can run
- the markdown file where comments are written
- live viewer/comment events

## Options

```text
Tunelito 0.1.1-beta.0

Usage: tunelito <page.html> [options]

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page>.comments.md)
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show help
```

## How It Works

Tunelito serves the HTML from disk and injects a small annotation client into the response. It does not modify the HTML file.

The injected client:

- shows a compact comments button
- lets reviewers select text and comment on the selection, including on mobile browsers
- syncs comments live over WebSocket
- highlights comment anchors with the browser Highlight API when available
- reloads when the source HTML changes on disk

The local server:

- serves sibling assets relative to the HTML file
- persists comments to markdown in real time
- restores comments from Tunelito metadata in that markdown if restarted
- optionally starts `cloudflared tunnel --url <local-url>` for a temporary public URL, falling back to `npx cloudflared@latest`

## Comment Files

By default, comments are written next to the source page:

```text
page.html
page.comments.md
```

The markdown is readable as-is and includes hidden metadata comments so Tunelito can restore live state after a restart.

## Beta Test Checklist

Use this before sharing a session link with someone else:

1. Start with a simple HTML page that does not already include another review system.
2. Run `tunelito ./page.html`.
3. Wait for the `Public:` URL.
4. Open the public URL on your phone.
5. Select text, tap the Tunelito `Comment` button, and submit a short comment.
6. Confirm the terminal logs `Comment from ...`.
7. Confirm `<page>.comments.md` exists and contains the comment.
8. Edit and save the HTML file; the phone should reload.

## Packaging a Beta Tarball

To send a standalone beta build without publishing to npm:

```bash
npm pack
```

Send the generated `tunelito-*.tgz` file. Your tester can install it with:

```bash
npm install -g ./tunelito-0.1.1-beta.0.tgz
```

The package intentionally includes only the CLI, runtime source, README, license, and examples.

## Notes

- Text annotations work best on real DOM text.
- Canvas, video, images, and cross-origin iframes are not yet annotatable.
- If you edit the exact text someone commented on, the comment remains in markdown and the sidebar, but the highlight may not reattach.
- Strict in-page CSP meta tags are removed from the served response so the injected same-origin client can run.
- Use `--no-tunnel` when you want to avoid starting any public tunnel process.
- Anyone with the temporary public URL can view the page and leave comments. Do not use a tunnel session for sensitive material unless you are comfortable with that exposure.
