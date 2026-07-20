# Architecture

Tunelito is intentionally small: a Node.js CLI, a local HTTP/WebSocket server, an injected browser client, optional WebRTC peer links, and markdown or in-memory comment storage.

## Boundaries

The CLI owns process orchestration:

- parse arguments
- choose host/port/comments path
- accept either a single HTML/Markdown file or a folder target
- choose persistent or ephemeral live mode
- choose optional local agent worker settings
- choose optional owner display identity
- resolve Markdown presentation settings from CLI, target-local project configuration, global configuration, and defaults
- report the resolved Markdown settings and source layers through read-only `tunelito config show`
- report read-only setup and safety diagnostics through `tunelito doctor`
- start a stdio MCP adapter for comments and inbox tools without starting a review server
- generate the review key
- start the local server
- start the local agent worker when requested
- optionally start Cloudflare Tunnel
- print shareable URLs and session events

The server owns local IO and transport:

- serve the selected HTML file at `/`, render selected Markdown as HTML, or serve a folder root with injected HTML/Markdown pages
- preserve authored `index.html`/`index.md` precedence and render a themed, response-only landing page for root or nested directory URLs without an index
- derive a recursively complete served-document navigation model for folder-mode Markdown while exposing only filtered, reachable Markdown/HTML files and safe directories
- apply the selected packaged Markdown theme and configured CSS only to served Markdown responses
- omit complete Markdown HTML comments from rendered prose while leaving source files and literal code examples untouched
- parse only bounded, complete, leading YAML front matter for the served Markdown response; keep malformed metadata visible as escaped review UI and leave the source file untouched
- turn supported Obsidian wiki syntax into escaped, semantically unresolved inline references without performing vault-wide lookup or inventing link destinations
- serve the fixed packaged Markdown interaction client behind normal review-key authorization
- turn exact `mermaid` code fences into source-preserving diagram figures and serve the fixed packaged Mermaid runtime/bootstrap routes behind normal review-key authorization
- serve non-hidden assets only from the selected file directory or folder root
- inject the review client at response time
- protect shared sessions with `tunelito_key`
- mark direct loopback local sessions as owners so local comments carry `authorRole: owner`
- mark public tunnel or forwarded sessions as visitors even when they carry the review key
- let direct local owner sessions approve a specific visitor comment for local-agent handling without changing the source file
- accept WebSocket comment events
- tie new comments to a stable reviewer identity so reviewer renames update only that reviewer's prior comments
- write/read markdown comments or keep live-mode comments in memory
- build a derived JSON comments index from the markdown inbox for agents and diagnostics, optionally enriched with processing status from the agent ledger
- emit in-memory `review.completed` handoff events when a reviewer clicks `Done Reviewing`
- expose a protected long-poll route for waiting on retained handoff events
- expose a read-only agent status projection for comments when an agent ledger is configured
- keep folder-mode page comments page-specific and site comments visible across the folder while storing one markdown inbox
- relay WebRTC signaling and fallback live events
- broadcast reload events when source files change; browser clients defer the actual reload while a comment composer is open

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

The review handoff event queue owns batch-finished signals when `Done Reviewing` or `tunelito review watch` is used:

- keep `review.completed` events in memory only, retained for the current server process
- include sequence id, created timestamp, target path, comments path when persistent, live mode, directory mode, summary counts, and optional event-only overall comment
- replay retained events after sequence `0` by default; allow callers to wait for future events with `--after latest`
- never write handoff events to source files, comments Markdown, or `.tunelito/agent/state.json`
- keep `--live` handoff events ephemeral and avoid creating a comments file

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
- render a `Done Reviewing` handoff action with acknowledged status
- submit comments over WebSocket and, in `--live`, fan out live events over WebRTC data channels when available
- render highlights and sidebar entries
- render agent work status on comment cards when `--agent` or `--agent-session` is active
- render peer cursors and live selection highlights in `--live`
- render optional pointer halos locally, and broadcast them as ephemeral live events in `--live`
- assign friendly editable visitor names, or seed the owner name for direct local owner sessions
- persist the current browser's reviewer identity so renames can update matching prior comments
- reconnect/reload when the server says to, while preserving an open comment composer by queueing reload until submit or close
- manage the shared Markdown left sidebar without writing state into the source document; injected navigation and source-derived Properties remain visibly separate
- build the right-edge Markdown document map from direct rendered content blocks, preserve existing heading ids, and provide h1-h6 and paragraph navigation with scroll-progress state
- coordinate the Markdown drawer, document map, Mermaid completion, and comments panel across responsive, dark-mode, keyboard, and reduced-motion states
- initialize Mermaid once per rendered Markdown page with strict security and render each pending figure once, preserving readable source on success or failure

## Invariants

- Never modify source HTML or Markdown files to install Tunelito.
- Never let Markdown themes or configuration rewrite the selected Markdown source.
- Never serve files outside the selected source file directory or selected folder root.
- Never serve a target-local `tunelito.config.json` through folder mode.
- Never include hidden, blocked, unsupported, or escaping paths in generated folder landing pages or Markdown navigation.
- Keep nested folder disclosures closed by default and keep generated navigation outside text-selection comment anchoring.
- Never expose a tunnel URL without the generated review key unless `--no-auth` is explicit.
- Never require an account, database, or hosted backend for the core workflow.
- Keep comments human-readable in markdown even if hidden metadata is damaged.
- Keep the `tunelito-comments` JSON index derived from markdown metadata plus optional agent-ledger status; do not make it durable state.
- Keep `--live` comments ephemeral; do not write them to markdown.
- Keep review handoff events ephemeral; do not write them to source files, comments markdown, or agent state.
- Keep pointer halos ephemeral; do not write pointer events to markdown or source files.
- Keep agent resolution state out of the comments markdown; the server owns comment persistence.
- Treat owner identity as server-assigned request metadata, not authentication; direct loopback local sessions are owners, public tunnel or forwarded sessions are visitors, and the review key remains the access gate.
- Treat reviewer identity as rename metadata, not authentication; legacy comments without reviewer IDs must not be rewritten by display-name guesses.
- Never run a local agent worker unless `--agent` or `--agent-command` is explicit.
- Never spawn a local agent worker for `--agent-session`; active-agent mode watches comments, prints prompts, and writes session metadata for the current agent session.
- Never spawn a local agent worker, server, tunnel, browser, or editor from `tunelito mcp`.
- Never use `--agent` with `--live`; the worker needs a persistent comments inbox.
- Never extract or reuse model provider credentials; provider presets call the user's installed CLI.
- Keep package installs dependency-light and cross-platform.
- Keep Markdown front-matter parsing bounded and presentation-only; never evaluate metadata or let it choose file or request paths.
- Keep Markdown configuration JSON-only and presentation-only; accept only known string settings, resolve local CSS relative to its owning config file, and escape inline CSS closing tags.
- Keep built-in themes packaged, dependency-free, and offline; theme selection must not fetch fonts or other theme assets.
- Hide only complete HTML comment tokens in rendered Markdown; preserve inline and fenced code literals and never remove text from the source file.
- Keep unresolved wiki references semantically honest: escaped visible text and target metadata are allowed, but fake `href` values and vault-wide filesystem discovery are not.
- Build document-map markers only from rendered blocks in the selected Markdown response; do not mutate source Markdown to add anchors or progress state.
- Keep Mermaid local/offline and same-origin; do not add a CDN dependency or allow request paths to select arbitrary files from installed dependencies.

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
