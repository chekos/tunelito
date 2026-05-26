# Architecture

Tunelito is intentionally small: a Node.js CLI, a local HTTP/WebSocket server, an injected browser client, optional WebRTC peer links, and markdown or in-memory comment storage.

## Boundaries

The CLI owns process orchestration:

- parse arguments
- choose host/port/comments path
- accept either a single HTML file or a folder target
- choose persistent or ephemeral live mode
- generate the review key
- start the local server
- optionally start Cloudflare Tunnel
- print shareable URLs and session events

The server owns local IO and transport:

- serve the selected HTML file at `/`, or serve a folder root with injected HTML pages
- serve non-hidden assets only from the selected file directory or folder root
- inject the review client at response time
- protect shared sessions with `tunelito_key`
- accept WebSocket comment events
- write/read markdown comments or keep live-mode comments in memory
- keep folder-mode comment streams page-specific while storing one markdown inbox
- relay WebRTC signaling and fallback live events
- broadcast reload events when source HTML changes

The browser client owns reviewer interaction:

- capture text selections
- render comment controls
- submit comments over WebSocket and, in `--live`, fan out live events over WebRTC data channels when available
- render highlights and sidebar entries
- render peer cursors and live selection highlights in `--live`
- reconnect/reload when the server says to

## Invariants

- Never modify source HTML files to install Tunelito.
- Never serve files outside the selected HTML file directory or selected folder root.
- Never expose a tunnel URL without the generated review key unless `--no-auth` is explicit.
- Never require an account, database, or hosted backend for the core workflow.
- Keep comments human-readable in markdown even if hidden metadata is damaged.
- Keep `--live` comments ephemeral; do not write them to markdown.
- Keep package installs dependency-light and cross-platform.

## Extension Points

Prefer these extension points before inventing new architecture:

- CLI option in `bin/tunelito.js`
- server route under `/__tunelito/*`
- message type in `src/ws.js` and `src/client.js`
- markdown metadata field in `src/comments.js`
- test coverage in `test/*.test.js`

## Agent-Native Fit

Tunelito itself is not yet a hosted agent application, but this repository is agent-native:

- The operating model lives in `AGENTS.md`, `CLAUDE.md`, and `docs/agents/`.
- Claude Code hooks enforce dangerous-operation and protected-file guardrails.
- Project skills encode common workflows as prompt-native features.
- Subagents isolate review concerns such as security, packaging, and tests.

When adding product features, preserve parity for agents: update docs and tests so future agents can run, verify, package, and release the feature without tribal knowledge.
