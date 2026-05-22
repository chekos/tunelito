# Architecture

Tunelito is intentionally small: a Node.js CLI, a local HTTP/WebSocket server, an injected browser client, and markdown persistence.

## Boundaries

The CLI owns process orchestration:

- parse arguments
- choose host/port/comments path
- generate the review key
- start the local server
- optionally start Cloudflare Tunnel
- print shareable URLs and session events

The server owns local IO and transport:

- serve the selected HTML file at `/`
- serve sibling assets from the HTML file directory
- inject the review client at response time
- protect shared sessions with `tunelito_key`
- accept WebSocket comment events
- write/read markdown comments
- broadcast reload events when the HTML changes

The browser client owns reviewer interaction:

- capture text selections
- render comment controls
- submit comments over WebSocket
- render highlights and sidebar entries
- reconnect/reload when the server says to

## Invariants

- Never modify the source HTML file to install Tunelito.
- Never serve files outside the selected HTML file's directory.
- Never expose a tunnel URL without the generated review key unless `--no-auth` is explicit.
- Never require an account, database, or hosted backend for the core workflow.
- Keep comments human-readable in markdown even if hidden metadata is damaged.
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
