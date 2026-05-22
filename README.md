# Tunelito

Tunelito turns any local HTML file into a temporary live review room.

You run one command, share the local or tunnel URL on a call, and reviewers can select text on the page to leave live comments. Your HTML file stays the source of truth: edit it in your normal editor, save, and connected browsers reload.

## Quick Start

```bash
npm install
npm link
tunelito ./data-architecture-walkthrough-review.html
```

Tunelito prints:

- a local URL
- a public Cloudflare Tunnel URL when `cloudflared` is installed, or when `npx cloudflared@latest` can run
- the markdown file where comments are written
- live viewer/comment events

Use `--no-tunnel` for local-only sessions:

```bash
tunelito ./page.html --no-tunnel --open
```

## Options

```text
Usage: tunelito <page.html> [options]

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page>.comments.md)
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --open                Open the local URL in your default browser
  -h, --help            Show help
```

## How It Works

Tunelito serves the HTML from disk and injects a small annotation client into the response. It does not modify the HTML file.

The injected client:

- shows a compact comments button
- lets reviewers select text and comment on the selection
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

## Notes

- Text annotations work best on real DOM text.
- Canvas, video, images, and cross-origin iframes are not yet annotatable.
- If you edit the exact text someone commented on, the comment remains in markdown and the sidebar, but the highlight may not reattach.
- Strict in-page CSP meta tags are removed from the served response so the injected same-origin client can run.
- Use `--no-tunnel` when you want to avoid starting any public tunnel process.
