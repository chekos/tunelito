# Architecture

Tunelito is intentionally small: a Node.js CLI, a local HTTP/WebSocket server, an injected browser client, optional WebRTC peer links, and markdown or in-memory comment storage.

## Boundaries

The CLI owns process orchestration:

- parse arguments
- choose host/port/comments path
- accept either a single HTML file or a folder target
- choose persistent or ephemeral live mode
- choose optional local agent worker settings
- generate the review key
- start the local server
- start the local agent worker when requested
- optionally start Cloudflare Tunnel
- print shareable URLs and session events

The server owns local IO and transport:

- serve the selected HTML file at `/`, or serve a folder root with injected HTML pages
- serve non-hidden assets only from the selected file directory or folder root
- inject the review client at response time
- protect shared sessions with `tunelito_key`
- accept WebSocket comment events
- write/read markdown comments or keep live-mode comments in memory
- keep folder-mode page comments page-specific and site comments visible across the folder while storing one markdown inbox
- relay WebRTC signaling and fallback live events
- broadcast reload events when source HTML changes

The local agent worker owns comment follow-up when `--agent` is enabled:

- poll the persistent markdown comments inbox
- keep `.tunelito/agent/state.json` as the durable resolution ledger
- invoke Codex, Claude Code, or a custom local command with a bounded prompt
- require structured JSON results before marking comments resolved
- continue any inline, page, or site comment that returns `needs_followup`, carrying forward completed and remaining tasks
- write `.tunelito/agent/log.md` for readable run history
- skip comments already marked `resolved`, `no-op`, `blocked`, `stale`, `ignored`, `partial`, or `changed_needs_review`
- stop continuation when `--agent-max-passes` is reached or a follow-up pass reports no observable progress

The browser client owns reviewer interaction:

- capture text selections
- create unanchored page notes and site-wide notes
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
- Keep agent resolution state out of the comments markdown; the server owns comment persistence.
- Never run a local agent worker unless `--agent` or `--agent-command` is explicit.
- Never use `--agent` with `--live`; the worker needs a persistent comments inbox.
- Never extract or reuse model provider credentials; provider presets call the user's installed CLI.
- Keep package installs dependency-light and cross-platform.

## Extension Points

Prefer these extension points before inventing new architecture:

- CLI option in `bin/tunelito.js`
- server route under `/__tunelito/*`
- message type in `src/ws.js` and `src/client.js`
- markdown metadata field in `src/comments.js`
- agent state/prompt/provider logic in `src/agent-worker.js`
- test coverage in `test/*.test.js`

## Agent-Native Fit

Tunelito itself is not yet a hosted agent application, but this repository is agent-native:

- The operating model lives in `AGENTS.md`, `CLAUDE.md`, and `docs/agents/`.
- Claude Code hooks enforce dangerous-operation and protected-file guardrails.
- Project skills encode common workflows as prompt-native features.
- Subagents isolate review concerns such as security, packaging, and tests.

When adding product features, preserve parity for agents: update docs and tests so future agents can run, verify, package, and release the feature without tribal knowledge.
