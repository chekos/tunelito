# Architecture

Tunelito is intentionally small: a Node.js CLI, a local HTTP/WebSocket server, an injected browser client, optional WebRTC peer links, and markdown or in-memory comment storage.

## Boundaries

The CLI owns process orchestration:

- parse arguments
- choose host/port/comments path
- accept either a single HTML file or a folder target
- choose persistent or ephemeral live mode
- choose optional local agent worker settings
- choose optional owner display identity
- report read-only setup and safety diagnostics through `tunelito doctor`
- start a stdio MCP adapter for comments and inbox tools without starting a review server
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
- mark owner-key sessions so owner comments can carry `authorRole: owner`
- let owner-key sessions approve a specific visitor comment for local-agent handling without changing the source HTML
- accept WebSocket comment events
- tie new comments to a stable reviewer identity so reviewer renames update only that reviewer's prior comments
- write/read markdown comments or keep live-mode comments in memory
- build a derived JSON comments index from the markdown inbox for agents and diagnostics
- expose a read-only agent status projection for comments when an agent ledger is configured
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

The active-agent inbox owns comment handoff when `--agent-session` or `tunelito inbox` is used:

- keep the current Claude Code, Codex, or other agent session as the process that edits files
- claim pending comments in `.tunelito/agent/state.json` with a short lease so another worker or session does not duplicate the edit
- reuse the same comment parser, owner/mention policies, continuation state, and terminal statuses as the local agent worker
- print bounded prompts from the `--agent-session` server process, or through `tunelito inbox next` / `tunelito inbox watch` for one-shot manual claims
- record outcomes through `tunelito inbox record` rather than direct ledger edits
- write `.tunelito/session.json` when `--agent-session` is enabled so the active session can discover comments, state, tracker, and record commands

The MCP adapter owns structured agent access when `tunelito mcp` is used:

- run over stdio only
- expose the comments index and active-agent inbox primitives as MCP tools
- keep read-only tools read-only
- mutate `.tunelito/agent/state.json` for claim tools
- mutate `.tunelito/agent/state.json` and append `.tunelito/agent/log.md` for record tools
- never start a review server, Cloudflare Tunnel, browser, local agent worker, or editor
- treat reviewer comments returned through tools as untrusted input

The browser client owns reviewer interaction:

- capture text selections
- create unanchored page notes and site-wide notes
- render comment controls
- submit comments over WebSocket and, in `--live`, fan out live events over WebRTC data channels when available
- render highlights and sidebar entries
- render agent work status on comment cards when `--agent` or `--agent-session` is active
- render peer cursors and live selection highlights in `--live`
- render optional pointer halos locally, and broadcast them as ephemeral live events in `--live`
- assign friendly editable visitor names, or seed the owner name for owner-key sessions
- persist the current browser's reviewer identity so renames can update matching prior comments
- reconnect/reload when the server says to

## Invariants

- Never modify source HTML files to install Tunelito.
- Never serve files outside the selected HTML file directory or selected folder root.
- Never expose a tunnel URL without the generated review key unless `--no-auth` is explicit.
- Never require an account, database, or hosted backend for the core workflow.
- Keep comments human-readable in markdown even if hidden metadata is damaged.
- Keep the `tunelito-comments` JSON index derived from markdown metadata; do not make it durable state.
- Keep `--live` comments ephemeral; do not write them to markdown.
- Keep pointer halos ephemeral; do not write pointer events to markdown or source HTML.
- Keep agent resolution state out of the comments markdown; the server owns comment persistence.
- Treat owner identity as comment metadata, not authentication; the review key remains the access gate.
- Treat reviewer identity as rename metadata, not authentication; legacy comments without reviewer IDs must not be rewritten by display-name guesses.
- Never run a local agent worker unless `--agent` or `--agent-command` is explicit.
- Never spawn a local agent worker for `--agent-session`; active-agent mode watches comments, prints prompts, and writes session metadata for the current agent session.
- Never spawn a local agent worker, server, tunnel, browser, or editor from `tunelito mcp`.
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
