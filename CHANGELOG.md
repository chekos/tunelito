# Changelog

## 0.27.0 - 2026-10-28

- Updates the bundled Tunelito agent skill: code blocks wrap by default and get a wrap toggle beside the copy button; pass `--no-code-wrap` or set `"codeWrap": false` when alignment matters.
- Wraps long lines in rendered Markdown code blocks by default (#148), so prose-like blocks such as agent prompts read without sideways scrolling. Long tokens such as URLs and paths break too. Wrapping is display only: the copy button still copies the original text with no added newlines, and comment quotes and offsets are unchanged. Each code block gets a wrap toggle next to its copy button (`aria-pressed`, keyboard reachable) for code where alignment matters. Agents and scripts set the default with `--no-code-wrap` / `--code-wrap` or `"codeWrap": false` in `tunelito.config.json` or the global config, and `tunelito config show` reports the resolved value and its source.

## 0.26.0 - 2026-10-17

- Updates the bundled Tunelito agent skill with resolver-backed link previews: loopback-only and owner-only by default, remote and visitor access opt-in only, and tokens only through `${env:…}` with `--link-preview-env`.

- Adds resolver-backed hover cards for bare Markdown links (#135). `--link-preview '<regex>' '<json-url-template>'`, with `--link-preview-fields title=…,status=…,priority=…`, or a `linkPreviews` entry in `tunelito.config.json` fills the existing link card with a title, status, and priority, so `[TLL-563](http://127.0.0.1:3100/TLL/issues/TLL-563)` needs no authored title. The Tunelito server fetches the resolver through a keyed, same-origin `/__tunelito/link-preview` route, and the browser never contacts the resolver. The fetch fails closed: loopback hosts only, no redirects, JSON only, at most 64 KiB, a 3-second timeout, four concurrent requests, a 60-second cache, and plain-text fields. By default only the direct local owner gets previews. `--link-preview-allow-remote` (https only) and `--link-preview-visitors` are CLI-only opt-ins. An authored link title still wins. Without a rule, nothing changes.
- Lets link-preview resolvers that need a token send request headers (#144). Add `--link-preview-header 'Authorization: Bearer ${env:TRACKER_TOKEN}'` after a `--link-preview` rule, or a `headers` map in a `linkPreviews` entry of your global config, and pass `--link-preview-env TRACKER_TOKEN` on the command line to allow that variable. A config file alone cannot turn headers on, and a project `tunelito.config.json` cannot hold `headers` at all. Secrets come only from environment variables: a literal value for a credential-looking header is refused, and `config show`, startup output, and errors show `${env:NAME}`, never the value. Headers go only to that rule's resolver origin over `https://` or loopback `http://`, never on a redirect, and only for the direct local owner, even with `--link-preview-visitors`. A missing variable shows no card and prints one warning naming it. CRLF, `Host`, hop-by-hop, and forwarding headers are refused.
- Shows one popup for a Markdown link with a CommonMark title. While the local hover card is open on hover or keyboard focus, Tunelito moves the `title` into a data attribute so the native tooltip does not stack on the card, points `aria-describedby` at the card, and keeps a title-only link's accessible name. Leaving or blurring the link restores the `title`, so the native tooltip still works wherever the card is unavailable.
- Colours Markdown links as external only when they point to another origin, using the same browser-side origin check that opens them in a new tab. Same-origin absolute `http(s)` links now look like other internal links.
- Pins link-preview resolver DNS answers (#142). Tunelito resolves the resolver host once per fetch, refuses the fetch unless every answer passes the host policy, and connects only to those checked addresses with `Host`, TLS SNI, and certificate validation kept on the configured hostname. Loopback rules must resolve only to loopback, so a `localhost` overridden in `/etc/hosts` is refused. With `--link-preview-allow-remote`, a hostname that resolves to a private, loopback, link-local, CGNAT, metadata, unspecified, or IPv4-mapped address is refused, and DNS rebinding cannot redirect the request.
- Bounds link-preview `match` regexes (#143). Each rule runs in a `node:vm` context with its own 25 ms timeout, in rule order. A pattern that times out returns no card, skips that href for 15 seconds, and logs at most one warning line per minute, so a catastrophic-backtracking pattern can no longer stall the review room.
- Makes the `browser:check` link step deterministic (#138). It waits for each fragment and footnote hash to commit and for the file watcher to report its source write before opening the page, so a late live reload can no longer destroy the page mid-check.

## 0.25.0 - 2026-10-17

- Updates the bundled Tunelito agent skill: wait through `Public:  waiting for DNS to propagate...` instead of restarting, put tracker context in link titles, and treat code-block copy buttons as presentation-only chrome.
- Opens links to another origin from rendered Markdown in a new tab with `rel="noopener noreferrer"`, so the review room stays open. Same-origin absolute, relative, root-relative, fragment, footnote, and `mailto:` links stay in the current tab, and Cmd/Ctrl-click and middle-click keep their browser behavior. Served HTML pages are unchanged.
- Adds a copy button to each fenced code block in rendered Markdown. It appears on hover or keyboard focus, copies the code exactly as written, announces "Copied" to screen readers, and falls back to a legacy copy when the async clipboard is unavailable. Mermaid diagrams and served HTML pages get no button, and comments anchored on code blocks are unchanged because the button holds no text and sits outside the comment surface's text.
- Documents that CommonMark link titles render as the native `title` tooltip, for example `[TLL-1](url "Title · status · priority")`, and adds regression coverage.
- Fixes Quick Tunnel startup when the system resolver caches a first `ENOTFOUND` for the new hostname, as macOS does. Tunelito now prints a `Public:  waiting for DNS to propagate...` line, checks the hostname through public DNS (1.1.1.1/1.0.0.1) and connects to that address with normal TLS certificate validation, and keeps verifying for up to about two minutes with capped backoff. `Public:` still appears only after the keyed request returns HTTP 200 with Tunelito's marker. If it times out, the message names the cause code (`ENOTFOUND`, a TLS error, `HTTP_<status>`, or `MISSING_MARKER`).

## 0.24.0 - 2026-09-30

- Keeps Markdown comments on an explicit `{#id}` or the nearest heading when the quoted text changes, and labels them stale only when that anchor is gone too. A repeated quote elsewhere on the page does not steal a comment whose anchor still exists. Nested `{#id}` markers stay on the list item that carries them.
- Renders known `{todo}` and `{high}` tokens as pills outside code, folds H2 and H3 sections per browser, and adds opt-in `--section-index` for a sticky section list on wide screens. Opening one subsection leaves earlier folded sections folded.
- Shows the recorded agent summary on comment cards and lets a reviewer hide resolved cards.
- Shows a local hover card for Markdown link titles.
- Selects the first document-map block at the top of a Markdown page and the last block at the bottom.

## 0.23.0 - 2026-07-31

- Adds opt-in `--editable` Markdown source editing for direct local owners, with public read-only responses, bounded same-origin writes, strong revision conflicts, atomic permission-preserving saves, dirty-draft reload protection, accessible browser controls, and explicit stale comment-anchor status.

## 0.22.1 - 2026-07-30

- Updates the bundled Tunelito agent skill to surface resolved theme/configuration behavior, distinguish implementation continuations from reviewer clarification, state the ephemeral no-promotion boundary, and direct Markdown feedback to source content instead of generated review UI.

## 0.22.0 - 2026-07-30

- Renders GFM footnote references and definitions as accessible numbered two-way links, including repeated references and table usage, while preserving source Markdown, existing safe-HTML/link boundaries, and comment reattachment.

## 0.21.3 - 2026-07-24

- Allows native `<details>` and `<summary>` disclosures in rendered Markdown while stripping all attributes except normalized `open` on `<details>`, preserving arbitrary HTML escaping and code/comment boundaries, and revealing collapsed ancestors when a comment target is opened.

## 0.21.2 - 2026-07-21

- Makes dark-only `bns-pitaya` the default theme for Markdown documents and generated folder pages while preserving the original neutral light/dark surface as the explicit `default` theme.

## 0.21.1 - 2026-07-20

- Adds canonical `--ephemeral` semantics with a prominent `--live` deprecation warning, explicit persistence language, and actionable incompatibility guidance for agent-backed reviews.
- Adds explicit, dry-run-capable `tunelito skill install` support for verified Codex and Claude user/project discovery paths, preserving existing files unless `--force` is requested.
- Adds `tunelito session status` with authenticated listener-identity verification, atomic private lifecycle metadata for every served target, redacted/JSON output, tunnel and agent health, and recovery guidance.

## 0.21.0 - 2026-07-20

- Replaces bare no-index directory listings with responsive, themed Tunelito folder landing pages for root, nested, and empty folders while preserving authored-index precedence and existing serving boundaries.
- Adds a clearly labeled, collapsible served-document tree to the left sidebar of Markdown directory sessions, with nested folders closed by default, encoded links, current-page state, and a separate source-derived Properties section.

## 0.20.1 - 2026-07-20

- Fixes Cloudflare Quick Tunnel discovery so provisioning URLs are ignored, output is parsed safely across stream/chunk boundaries, and `Public:` appears only after the generated hostname is verified against the authenticated Tunelito server and persisted for agent-session recovery.
- Makes the bundled agent workflow prominent in top-level CLI help and lets `tunelito doctor` advise detected Codex or Claude Code sessions when a target is being evaluated without an agent mode.

## 0.20.0 - 2026-07-17

- Adds four packaged Markdown themes—`default`, `editorial`, `technical`, and dark-only `bns-pitaya`—with offline font fallbacks, light/dark compatibility coverage, accessibility checks, and committed visual evidence.
- Adds layered Markdown presentation configuration through `--theme`, target-local and global `tunelito.config.json` files, and read-only `tunelito config show`, while preserving `--markdown-css` as the final override.
- Hides complete inline, block, multiline, and adjacent HTML comments from rendered Markdown while preserving the source file and literal comment syntax inside inline and fenced code.

## 0.19.0 - 2026-07-16

- Adds a polished, collapsible left-side Properties drawer for bounded leading YAML front matter, with ordered values, nested metadata, reload persistence, dark mode, responsive behavior, and a readable invalid-YAML fallback.
- Renders common Obsidian wiki references as escaped, semantically honest unresolved references while preserving embeds, code, escaped literals, and raw-HTML boundaries for future vault-resolution work.
- Adds a keyboard-accessible, vertically centered right-edge Markdown document-map dial with transient hover expansion, paragraph progress, h1-h6 hierarchy, click navigation, responsive comments-panel coexistence, dark mode, and reduced-motion support.
- Adds the durable Markdown fixture taxonomy, automated browser and accessibility coverage, and real UI screenshot sources for metadata, wiki references, document-map density, long-form content, Mermaid, and HTML-shell regression checks.

## 0.18.0 - 2026-07-10

- Renders fenced `mermaid` blocks as diagrams in single-file and folder Markdown reviews, using a packaged same-origin runtime with strict security settings and a readable source fallback when rendering fails.

## 0.17.0 - 2026-06-29

- Adds first-class Markdown review targets: `.md` files and Markdown pages inside folder reviews render as readable, commentable pages with live reload and optional `--markdown-css` styling.

## 0.16.1 - 2026-06-25

- Clarifies that the bundled Tunelito agent skill defaults to the rolling `--agent-session` review loop, with batch `Done Reviewing` and spawned `--agent` worker modes as explicit opt-ins.

## 0.16.0 - 2026-06-25

- Keeps live reload from clearing an open reviewer comment composer; reload is queued until the draft is submitted or closed.
- Adds agent-processing status to the `tunelito comments inspect` JSON index, including pending, unhandled, completed, and per-comment claim details when a ledger is available.
- Makes active-agent claim recovery easier by showing claim ids in `inbox status`, distinguishing foreground inbox claims from `--agent-session` claims, and allowing `inbox record --claim auto`.
- Updates the bundled Tunelito agent skill with active-agent loop guidance for stable review URLs, non-blocking inbox checks, single-claimer discipline, and zero-pending verification.

## 0.15.0 - 2026-06-24

- Treat direct local sessions as owner-authored and public tunnel or forwarded sessions as visitors, removing the old owner-key URL from session role assignment.

## 0.14.1 - 2026-06-18

- Publishes a patch package for the current bundled Tunelito agent skill after syncing the saved BNS marketplace copy.

## 0.14.0 - 2026-06-18

- Adds `tunelito skill setup`, a no-write onboarding guide for installing or referencing the bundled skill across common coding agents.
- Adds a browser `Done Reviewing` handoff action plus `tunelito review watch` for waiting on in-memory `review.completed` events.
- Adds `tunelito mcp`, a stdio MCP adapter for comments index, pending feedback, claim, watch, record, and inbox status tools.
- Adds `tunelito doctor`, a read-only diagnostic command for local setup, comments inbox health, agent ledger JSON, ports, tunnel availability, and safety warnings.
- Adds `tunelito comments inspect`, a versioned JSON comments index for agents and diagnostics that derives from the existing Markdown inbox.

## 0.13.0 - 2026-06-17

- Adds owner approval for visitor comments, letting owner-keyed sessions approve a specific visitor comment for local-agent work without rewriting it as an owner comment.
- Replaces `Guest <code>` reviewer names with friendly assigned names and lets reviewers rename prior comments tied to the same reviewer identity.
- Adds a default-off presenter pointer halo for fine-pointer devices, with ephemeral peer broadcast in `--live`.

## 0.12.0 - 2026-06-12

- Adds browser-visible agent work status on comment cards, plus `tunelito inbox status` as the matching terminal tracker. Reviewers can see queued, in-progress, follow-up, and integrated feedback directly in the Tunelito panel.

## 0.11.0 - 2026-06-10

- Makes `--agent-session` watch and claim comments from the serving process, so current-agent review sessions start with one command instead of a separate `inbox watch` step.

## 0.10.1 - 2026-06-10

- Simplifies shared local-agent and active-agent inbox configuration normalization without changing CLI behavior.
- Adds direct regression coverage for agent config validation order and trigger defaults.

## 0.10.0 - 2026-06-10

- Adds active-agent inbox commands: `tunelito inbox next`, `tunelito inbox watch`, and `tunelito inbox record` let the current Claude Code, Codex, or other agent session claim and resolve Tunelito comments without spawning a nested worker.
- Guards active-agent recordings with claim ids, so `inbox watch` prints the exact `inbox record --claim ...` command for the current lease.
- Adds `--agent-session`, which prints inbox commands and writes `.tunelito/session.json` for current-agent comment watching while preserving the existing `--agent` worker path for unattended auto-apply sessions.

## 0.9.0 - 2026-06-09

- Adds `tunelito skill show`, which prints the distributable Tunelito agent skill (SKILL.md) so a coding agent can install it (for example `tunelito skill show > .claude/skills/tunelito/SKILL.md`).
- Rewrites the distributable agent skill into a start → share → process → wrap-up guide covering the comment Markdown schema, the `--agent` worker, and applying a `*.comments.md` inbox by hand.
- Documents that `--no-auth` does not disable the tunnel (a tunneled `--no-auth` session is a public, ungated URL) and that `--live` changes persistence, not exposure.

## 0.8.1 - 2026-06-08

- Keeps single-file live reload working after repeated atomic-save edits by watching the parent directory and filtering for the served HTML file.
- Keeps the floating comment composer visible near the bottom of the viewport by flipping or clamping it on desktop while preserving the mobile bottom-sheet layout.

## 0.8.0 - 2026-06-08

- Adds `--agent-policy` for deterministic local-agent comment gating by all comments, trigger mentions, owner comments, or owner-or-mention sessions.
- Wakes the local agent worker when the persistent comments markdown changes, while keeping interval polling as a fallback.

## 0.7.0 - 2026-06-08

- Adds random editable reviewer names and `--owner <name>` so local owner comments are labeled for humans and local agent prompts.

## 0.6.3 - 2026-06-05

- Prevents visible reviewer text that looks like Tunelito metadata from being restored as an extra hidden comment.
- Closes malformed WebSocket frames without taking down the local review server.
- Keeps client injection working when the served HTML mentions `/__tunelito/client.js` as ordinary page text.
- Rejects partial numeric CLI option values such as `--port 4317junk`.

## 0.6.2 - 2026-05-28

- Makes the injected comments launcher less disruptive on mobile by replacing the large bottom pill with a compact icon button and count badge above common bottom navigation.

## 0.6.1 - 2026-05-28

- Preserves saved `needs_followup` continuation context after retryable local-agent failures so retries still receive completed and remaining tasks.

## 0.6.0 - 2026-05-28

- Adds multi-pass local agent continuations: agents can return `needs_followup` for any inline, page, or site comment, Tunelito carries completed and remaining tasks into the next prompt, and `--agent-max-passes` bounds broad work.
- Separates failed-run retries from continuation passes and stops follow-up loops that report no observable progress.

## 0.5.0 - 2026-05-28

- Adds page notes and site-wide comments: reviewers can now leave unanchored feedback, folder sessions show site comments on every page, and the local agent worker receives comment scope in its prompt and retry fingerprint.
- Adds an automated package smoke check that proves the packed tarball exposes a runnable `tunelito` CLI through global install and `npx --package`.

## 0.4.1

- Makes the local agent worker evaluate all persistent comments by default, with `--agent-trigger` still available for marker-gated sessions.
- Adds `--agent-instructions`, `--agent-instructions-file`, `--agent-prompt`, and `--agent-prompt-file` for appending host guidance or replacing the built-in worker behavior prompt.
- Updates the worker prompt so agents can mark non-actionable comments `ignored` instead of requiring every comment to become an edit.

## 0.4.0

- Adds an opt-in local agent worker that can poll persistent comments and invoke Codex, Claude Code, or a custom local CLI to edit the matching HTML files.
- Adds a durable `.tunelito/agent/state.json` resolution ledger so handled comments are not retried after source edits make their highlights stale.
- Documents the on-the-go folder review workflow, provider options, status states, and local agent guardrails.

## 0.3.1

- Adds a dedicated folder review tutorial and links it from the quickstart, comments docs, docs landing page, and README.

## 0.3.0

- Adds folder targets so `tunelito ./site` serves a folder of HTML files, injects review UI into served HTML pages, and keeps one page-aware comments inbox.
- Shows visible page paths and comment IDs in comment markdown for coding-agent inbox workflows.

## 0.2.0

- Adds `--live` for ephemeral in-meeting collaboration without writing comments to disk.
- Adds WebRTC peer signaling and browser data channels for live cursors, selection highlights, and instant comment fanout, with the existing WebSocket room as the authenticated fallback relay.
- Keeps persistent Markdown comment sessions as the default workflow.
- Added a local release doctor, lightweight CLI smoke check, and a configurable Cloudflare Tunnel fallback package for deterministic hardening.

## 0.1.1

- Publishes Tunelito to npm so reviewers can start with `npx --yes tunelito ./page.html`.
- Promotes the package docs from GitHub installation to npm-first usage.
- Configures npm trusted publishing for GitHub Actions and skips already-published versions in the release workflow.
- Rolls up the 0.1.1 prerelease work: review-key URLs, Node.js 22+ support, CI/trusted-publishing scaffolding, security/release docs, mobile text selection, package metadata, and the bundled smoke-test example.

## 0.1.1-beta.2

- Keeps GitHub installs clean by relying on explicit CI/release checks instead of a `prepack` hook.

## 0.1.1-beta.1

- Raises the supported runtime to active LTS Node.js 22+.
- Adds generated review-key URLs for shared sessions by default.
- Adds CI across Node.js 22, 24, and 26.
- Adds trusted-publishing release workflow scaffolding.
- Adds security and release documentation.
- Polishes the README for beta testers.

## 0.1.1-beta.0

- Adds beta package metadata for GitHub/tarball installs.
- Adds mobile text-selection support for the injected annotation flow.
- Adds a clean example page for smoke tests and beta demos.
- Adds package dry-run validation and tarball install smoke coverage to the release process.

## 0.1.0

- Adds the initial Tunelito CLI, local server, injected comment layer, WebSocket sync, markdown persistence, file-watch reloads, and optional Cloudflare Tunnel sharing.
