---
name: tunelito-live-smoke
description: Run a live local Tunelito smoke test against an HTML page. Use before declaring browser/client/server/package changes ready.
disable-model-invocation: true
argument-hint: [html-file]
allowed-tools: Read, Grep, Glob, Bash
---

## Smoke Target

HTML file argument: `$ARGUMENTS`

If no argument is provided, use `examples/simple-review.html`.

## Workflow

1. Pick an open port.
2. Start Tunelito with `--no-tunnel`.
3. Confirm startup output includes a keyed `Local:` URL and `Access: review key required`.
4. Confirm unkeyed `/` returns `401`.
5. Confirm keyed `/` contains the expected page content and injected `/__tunelito/client.js`.
6. Confirm keyed `/__tunelito/client.js` contains WebSocket setup and `tunelito_key` propagation.
7. Stop the server process.

Do not leave a server running. Summarize exact URLs, status codes, and commands.
