# Tunelito

[![CI](https://github.com/chekos/tunelito/actions/workflows/ci.yml/badge.svg)](https://github.com/chekos/tunelito/actions/workflows/ci.yml)

Tunelito turns any local HTML or Markdown file, or a folder of HTML and Markdown files, into a temporary live review room.

Run one command, share the printed URL on a call, and reviewers can select text, leave page notes, or leave site-wide notes. You keep editing the source in your normal editor; connected browsers reload when files change, and reload waits when a reviewer has an open comment composer. Comments are saved as readable markdown beside the page or folder by default, or kept ephemeral with `--live`.

Tunelito is local-first: your files stay on your machine, the public URL is a temporary tunnel to your laptop, and edit access never leaves your editor.

## Quickstart

Tunelito requires Node.js 22 or newer.

```bash
npx --yes tunelito ./page.html
```

For a Markdown memo or draft:

```bash
npx --yes tunelito ./notes.md
```

For a folder-backed mini-site:

```bash
npx --yes tunelito ./site
```

Folder reviews write one Markdown inbox beside the folder:

```text
site/
site.comments.md
```

Each comment includes a scope, page path, and visible comment id, so Claude Code, Codex, or another local agent can watch that file, apply edits to the matching HTML or Markdown file or the whole folder when a comment is site-wide, and continue larger comments across bounded follow-up passes.

To let a local agent handle comments while Tunelito runs:

```bash
npx --yes tunelito ./site --agent codex
```

Use `--agent claude` for Claude Code, or `--agent-command "<your command>"` for another local CLI. Tunelito sends prompts to that command on stdin and tracks handled comment IDs in `.tunelito/agent/state.json`.

If you are already inside Claude Code, Codex, or another agent session, use agent-session mode instead of spawning a child agent:

```bash
npx --yes tunelito ./site --agent-session --no-tunnel --open
```

The same Tunelito process serves the review room, watches the comments inbox, claims the next actionable comment, and prints a prompt for the current agent. Reviewers see agent work status on each browser comment card, so feedback can move from queued to being worked on to integrated without opening the markdown inbox. After editing, record the result with the `tunelito inbox record --claim ...` command from the prompt.

To see the same live checklist in the terminal:

```bash
npx --yes tunelito inbox status ./site
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

Share the `Public:` URL with the person on your call. Open the `Local:` URL yourself; direct local sessions are marked as the owner, while public tunnel sessions are marked as visitors.

To seed your local owner display name:

```bash
tunelito ./page.html --owner "Chekos"
```

Tunelito assigns everyone else a friendly editable display name, so comments from multiple reviewers are easy to tell apart.

For local-only work:

```bash
tunelito ./page.html --no-tunnel --open
```

To diagnose local setup, target paths, comments inbox health, agent ledger JSON, port availability, tunnel availability, and risky auth/tunnel combinations without starting a server:

```bash
tunelito doctor ./page.html --json
```

For in-meeting collaboration without writing comments to disk:

```bash
tunelito ./page.html --live
```

## What Reviewers Can Do

- Select text on desktop or mobile.
- Tap `Comment` and leave a note on the selected text.
- Add a `Page note` without selecting text.
- Add a `Site note` that appears on every page in a folder review.
- Keep or edit their assigned display name. Renaming updates earlier comments from the same reviewer identity.
- Toggle a local pointer halo on fine-pointer devices when pointing during a call.
- See other comments appear live.
- In `--live`, see peer cursors, live selection highlights, and pointer halos when the browser can connect peer-to-peer.
- In persistent sessions, open the generated markdown comments file from the panel.

## What You Control

- The source HTML and Markdown files remain untouched by Tunelito's annotation layer.
- Edits happen in your editor only.
- Saved HTML changes trigger a live reload in connected browsers.
- Comments persist to `<page-or-folder>.comments.md` unless you choose another path with `--out`.
- `--live` keeps comments in memory only; the session disappears when the local server exits.

## Markdown Review Surfaces

Markdown reviews keep the source file untouched while adding three presentation-only surfaces to the served response:

- A leading YAML front-matter mapping appears in a collapsible left `Properties` drawer. Tunelito recognizes it only at the start of the file (after an optional UTF-8 BOM) with complete `---` delimiters. Real YAML scalars, quoted strings, booleans, numbers, dates, arrays, and nested values are accepted in source order. Parsing is bounded to 64 KB and eight nested levels. Invalid YAML leaves the article readable and exposes an escaped copy of the original front matter in an accessible error disclosure.
- Obsidian wiki references render without bracket noise: `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `[[#Heading]]`, and `[[Note#Heading|Alias]]`. This release deliberately does not resolve a vault, create fake links, or support `![[embeds]]`; unresolved references are styled inline text with normalized target metadata for future navigation. Wiki syntax inside inline/fenced code, escaped literals, and escaped raw HTML remains literal.
- A compact, vertically centered document-map dial at the desktop right edge derives one tick from every real top-level heading, paragraph, list, blockquote, code block, table, figure, Mermaid figure, or thematic break. Its track is capped at 500px and preserves 60px of vertical breathing room on shorter desktop viewports. Heading ticks step from h1 (longest) through h6; h5 and h6 remain navigable 14px and 12px heading marks rather than disappearing. The current block is teal, consumed marks recede toward the theme background, and heading labels expand while the dial is hovered or visibly keyboard-focused, then retreat when the pointer leaves. Every tick navigates; Arrow keys, Page keys, Home, End, and Escape support keyboard use without a separate pin control, paragraph hashes, or a visual progress number.

Properties open on a first desktop visit and remember their collapsed/open preference across full-page reloads. Narrow layouts start with a collapsed sheet, and the document map is hidden at 760px and below. On wide desktops the map shifts beside an open comments panel; at narrower desktop widths it temporarily hides while comments are open. Both surfaces respect dark mode and `prefers-reduced-motion`, and `--markdown-css` still loads after the built-in Markdown styles.

## CLI

```text
Tunelito 0.18.0

Usage: tunelito <page.html|notes.md|folder> [options]
       tunelito doctor [page.html|notes.md|folder] [options]
       tunelito mcp
       tunelito comments inspect <page.html|notes.md|folder|comments.md> [options]
       tunelito review watch [page.html|notes.md|folder] [options]
       tunelito inbox <next|watch|status|record> <page.html|notes.md|folder> [options]
       tunelito skill <show|setup>

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page-or-folder>.comments.md)
  --markdown-css <href> Add a stylesheet link to rendered Markdown pages
  --owner <name>        Seed the editable owner name for the direct local viewer
  --live                Use ephemeral live collaboration mode; do not write comments to disk
  --agent <codex|claude|custom>
                        Run a local coding-agent worker for persistent comments
  --agent-command <cmd> Custom shell command for --agent custom; prompt is sent on stdin
  --agent-interval <s>  Agent fallback polling interval in seconds (default: 120)
  --agent-policy <mode> Which comments are actionable: all|mention|owner|owner-or-mention (default: all)
  --agent-trigger <txt> Marker for mention policies, or "all" (default: all)
  --agent-instructions <txt>
                        Append host instructions to the built-in agent prompt
  --agent-instructions-file <path>
                        Append host instructions from a file
  --agent-prompt <txt>  Replace the built-in agent behavior prompt
  --agent-prompt-file <path>
                        Replace the built-in agent behavior prompt from a file
  --agent-max-attempts <n>
                        Stop retrying a comment after n attempts (default: 2)
  --agent-max-passes <n>
                        Stop continuing a multi-pass comment after n agent passes (default: 3)
  --agent-state <path>  Agent resolution ledger (default: <target>/.tunelito/agent/state.json)
  --agent-session       Watch comments for the current agent session; do not spawn a worker
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --no-auth             Disable the generated review-key URL gate
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show this help

Commands:
  doctor                Run read-only local setup and safety diagnostics
  mcp                   Start a stdio MCP server for comments and inbox tools
  comments inspect      Print a structured JSON index for a Tunelito comments inbox
  review watch          Wait for a browser Done Reviewing handoff event
  inbox next            Claim the next pending comment and print an agent prompt
  inbox watch           Wait for the next pending comment, then print an agent prompt
  inbox status          Print a live to-do tracker from the comments inbox and ledger
  inbox record          Record the active agent's result for one comment
  skill show            Print the distributable Tunelito agent skill (SKILL.md)
  skill setup           Print no-write setup guidance for common coding agents
                        for a coding agent to install
```

## Agent Skill

Tunelito ships an agent skill that teaches a coding agent (Claude Code, Codex, Cursor, and others) how to drive Tunelito: starting and sharing a review session safely, keeping sensitive pages local, and applying the comments from a `*.comments.md` inbox.

The stable installation path is to have your agent print the bundled skill and install that output however the agent expects:

```bash
npx --yes tunelito skill show
```

For guided no-write setup instructions across Claude Code, Codex, Cursor, Gemini, opencode, and Copilot-style agents:

```bash
npx --yes tunelito skill setup
```

For Claude Code, for example:

```bash
tunelito skill show > .claude/skills/tunelito/SKILL.md
```

Or tell your agent: "run `npx --yes tunelito skill setup`, inspect the existing project instructions, and install the skill without deleting local rules." The setup command prints guidance only; it does not write files, install packages, or edit global agent configuration.

## How It Works

Tunelito serves HTML from disk or renders Markdown into a readable page, then injects small same-origin clients into the response. Markdown front matter, wiki references, Mermaid, and the document map are rendered or discovered only in the served page. For folder targets, every served `.html`, `.htm`, or `.md` page gets the annotation client and shares one comments inbox. Page-scoped comments appear only on their current page; site-scoped comments appear on every page in that folder session. The injected client handles selection, unanchored page/site notes, highlights, live sync, optional pointer halos, and reload notices. The original source files are not modified by Tunelito's annotation layer.

The server also:

- serves sibling assets relative to the selected file, or non-hidden files within the selected folder
- renders Markdown with a built-in readable stylesheet, optionally adding `--markdown-css <href>` for team styling
- parses bounded leading YAML front matter into an escaped, reload-persistent left properties drawer with a readable invalid-YAML fallback
- renders common Obsidian wiki references as semantically honest inline references without vault-wide resolution or embed support
- builds a keyboard-accessible, opacity-based desktop document map from the real rendered Markdown blocks, including explicit h1–h6 navigation
- renders fenced `mermaid` blocks from a packaged same-origin runtime, with Mermaid strict security, bounded diagram complexity, and an accessible source fallback if JavaScript or diagram syntax fails
- writes comments to markdown atomically
- restores prior comments from hidden Tunelito metadata in that markdown
- can run an opt-in local agent worker against persistent comments
- relays WebRTC signaling and ephemeral live fallback events, including peer cursors and pointer halos, in `--live`
- starts `cloudflared tunnel --url <local-url>` when available
- falls back to `npx cloudflared@latest` when `cloudflared` is not installed

Set `TUNELITO_CLOUDFLARED_PACKAGE=cloudflared@<version>` to pin the fallback package used by `npx` while keeping the default behavior on `cloudflared@latest`.

## Access Model

Shared sessions include a generated `tunelito_key` in the printed URLs by default. The key is bearer access: anyone with the full URL can view the page and leave comments. The first valid request sets a short-lived, HTTP-only cookie so page assets and WebSocket sync keep working.

Tunelito assigns roles on the server. Requests made through the direct loopback `Local:` URL are treated as the owner; requests made through public tunnel or forwarded URLs are treated as visitors. `--owner <name>` only seeds the editable display name for the local owner. Visitors cannot become owners by changing browser state or submitted comment fields, and the public tunnel URL never carries owner privileges. If the owner opens the `Public:` URL, that browser is treated as a visitor.

Owner-authored comments are marked in Markdown, and the local owner can approve specific visitor comments for local-agent work. The local agent worker receives the owner name when configured, each comment's author role, and any owner approval metadata. Owner labels are still collaboration metadata, not account authentication; the review key remains the access gate.

`--no-auth` only removes the review-key gate; it does **not** disable the tunnel. A tunneled session started with `--no-auth` is a public, unauthenticated URL that anyone who finds it can open and edit. If you want no key you almost always want local-only too, so add `--no-tunnel`. Use `--no-auth` only for local demos or trusted networks.

`--live` changes persistence, not exposure: it keeps comments in memory instead of writing them to disk, but the session is still served over the same tunnel and review key. For sensitive material, prefer `--no-tunnel` (optionally with `--live`) or avoid sharing the session link.

## Comment Files

By default:

```text
page.html
page.comments.md
```

For folder targets, the default comments file is beside the folder:

```text
site/
site.comments.md
```

The markdown is meant to be readable in any editor:

```markdown
# Tunelito comments for `page.html`

## Jane at 2026-05-22 18:00:00 UTC

> selected text

This sentence needs a clearer verb.

_Context: scope: `page` · page: `/about.html` · path: `body > main > p` · text offset: 42 · id: `c_...`_
```

Owner comments add an owner marker:

```markdown
## Chekos (owner) at 2026-05-22 18:02:00 UTC

> selected text

Ship this version after the headline change.

_Context: author role: `owner` · scope: `page` · page: `/` · path: `body > main > h1` · text offset: 0 · id: `c_...`_
```

Unanchored notes are stored without a selected quote:

```markdown
## Jane at 2026-05-22 18:05:00 UTC

_Site note (no selected text)._

Use the same heading rhythm across every itinerary page.

_Context: scope: `site` · page: `/day-03.html` · id: `c_...`_
```

If a site comment is created from selected text, Tunelito keeps the quote for context and highlights it on the origin page only.

Tunelito also stores hidden metadata comments so the live session can be restored after a restart. That metadata includes a stable reviewer identity for new comments, which lets a reviewer rename themselves and update earlier comments from the same browser session. Older comments without reviewer identity metadata are left unchanged during renames instead of being guessed by matching display names.

Agents and tools can read a structured JSON view of the same Markdown inbox:

```bash
tunelito comments inspect ./site --json
tunelito comments inspect ./site --out ./custom.comments.md --json
tunelito comments inspect ./site.comments.md --agent-state ./site/.tunelito/agent/state.json --json
tunelito comments inspect ./site.comments.md --json
```

The JSON index is derived from hidden Tunelito metadata; it does not replace the readable Markdown file or write to source files. For page or folder targets, the index also includes per-comment agent status from `.tunelito/agent/state.json` when a ledger is available, plus top-level pending, unhandled, and completed counts. Missing default comments files for page or folder targets return an empty index, while direct inspection of a missing or unrecognized Markdown file returns diagnostics.

In `--live`, comments are not written to markdown and are not restored after restart.

## Agent Comment Loop

The persistent comments file is a practical inbox for Claude Code, Codex, or another local coding agent. Folder comments include `scope: ...`, `page: ...`, and `id: ...` in their visible context. Local owner comments carry `authorRole: "owner"`; public tunnel comments carry `authorRole: "visitor"`. When `--owner` is set, the worker prompt also includes the owner name, each comment's author role, and owner approval metadata for approved visitor comments. Host instructions can ask the agent to prefer owner comments or wait for owner approval.

If you are already inside an agent session, let the current agent own the loop:

```bash
tunelito ./site --agent-session --owner "Chekos" --agent-policy owner-or-mention --agent-trigger "@agent"
```

Tunelito serves the review room, writes `.tunelito/session.json` beside the served root, watches the comments markdown in the same process, and prints a bounded prompt whenever it claims an actionable comment for the current agent. It does not spawn a nested worker. After editing the source files, record the outcome with the claim id from the printed command:

```bash
tunelito inbox record ./site --id c_... --claim claim_... --status resolved --summary "Updated the hero copy." --file index.html
```

The browser panel shows matching status badges and task details on each comment card. Use `tunelito inbox status ./site` to print the current tracker in the terminal. Pending and claimed comment work appears as unchecked tasks, claimed work includes the active claim id, and completed work is printed as checked and crossed out.

Use repeated `tunelito inbox next ./site` calls for non-blocking manual checks from an agent shell, or `tunelito inbox watch ./site` when you need the one-shot waiting primitive without running the server in `--agent-session` mode. Use repeated `--file`, `--completed`, and `--remaining` flags when recording multi-file or `needs_followup` work. Run one active inbox claimer per served workspace; a foreground `inbox next/watch` call against a workspace already served with `--agent-session` is another claimer. Claim ids are local leases that prevent stale recordings and let abandoned claims expire, not a distributed lock. If a foreground record needs to resolve the currently owning claim, pass `--claim auto` instead of opening `.tunelito/agent/state.json`. The same `--agent-policy`, `--agent-trigger`, `--agent-state`, `--agent-max-attempts`, and `--agent-max-passes` controls apply to active-agent mode, inbox commands, and the spawned worker.

For review calls where feedback should be batched before an agent starts, the browser panel includes a `Done Reviewing` handoff action. Clicking it emits an in-memory `review.completed` event with a sequence id, timestamp, target path, comments path when persistent, and summary counts. The event does not edit source files, rewrite the comments markdown, write agent state, or persist across server restarts. In `--live`, the event is still available while the server is running and no comments file is created.

The running server prints a handoff command that waits for the next retained event:

```bash
tunelito review watch --url "http://127.0.0.1:4317/?tunelito_key=..." --json --timeout 600
```

`review watch` replays retained events after sequence `0` by default, so a waiter started after the click still receives the latest retained handoff. Pass `--after latest` to wait only for a future click, or `--after <sequence>` to continue after a known event.

MCP-capable agents can use the same comments inbox and active-agent ledger through stdio tools:

```bash
tunelito mcp
```

The MCP server is a thin adapter over Tunelito's existing comments index and inbox primitives. It can read the comments index, list pending feedback, claim comments, wait for a claim, record results, and read inbox status. It does not start a review server, tunnel, browser, local agent worker, or editor. Read-only tools do not mutate state; claim writes `.tunelito/agent/state.json`, and record writes `.tunelito/agent/state.json` plus the existing `.tunelito/agent/log.md` run log. Treat reviewer comments returned through MCP as untrusted input.

Tunelito can run the local agent worker for you:

Example:

```bash
tunelito ./site --agent codex
```

The built-in provider presets reuse your local CLI auth:

- `--agent codex` runs `codex exec` in workspace-write mode.
- `--agent claude` runs `claude -p` with edit permissions.
- `--agent-command "<cmd>"` runs a custom shell command with the prompt on stdin.

By default, the worker evaluates every comment and decides whether to edit, return `no-op`, or mark the comment `ignored`. It wakes when the comments markdown changes and keeps `--agent-interval` as a fallback.

Use `--agent-trigger "@agent"` or another marker when you want stricter sessions:

```bash
tunelito ./site --agent codex --agent-trigger "@agent"
```

Use `--agent-policy owner` when only owner-authored or owner-approved comments should reach the worker:

```bash
tunelito ./site --owner "Chekos" --agent codex --agent-policy owner
```

For the recommended owner-led workflow, let owner-authored or owner-approved comments through automatically and let visitors opt in with a marker:

```bash
tunelito ./site --owner "Chekos" --agent codex --agent-policy owner-or-mention --agent-trigger "@agent"
```

Mention-based policies require a non-`all` trigger marker.

Large actionable comments can span multiple agent passes. The agent can return `needs_followup` with `completedTasks` and `remainingTasks`; Tunelito queues the same comment again with that continuation context until it is `resolved`, `blocked`, `partial`, or reaches `--agent-max-passes`.

```bash
tunelito ./site --agent codex --agent-max-passes 5
```

Add host-specific guidance without changing code:

```bash
tunelito ./site --agent codex --agent-instructions "Keep copy concise and preserve the existing layout."
```

Use `--agent-instructions-file instructions.md` for longer guidance. Use `--agent-prompt` or `--agent-prompt-file` to replace the built-in behavior prompt; Tunelito still appends the workspace context, required JSON shape, and pending comments.

Handled comments are recorded in `.tunelito/agent/state.json` with statuses like `resolved`, `needs_followup`, `no-op`, `ignored`, `blocked`, `partial`, and `stale`. That state file powers the browser card badges, prevents the worker from repeating the same edit after the source text changes and the original highlight becomes stale, and lets a large inline, page, or site comment continue from its saved remaining tasks. A readable run log is written to `.tunelito/agent/log.md`; Tunelito blocks both files from static serving and ignores `.tunelito` ledger writes for browser reloads.

Treat `--agent` as trusted-session behavior: reviewer comments become instructions to a local process that can edit files.

Manual agent prompt for older builds:

```text
Monitor site.comments.md every 2 minutes. For each new actionable comment, edit the matching HTML or Markdown file, then summarize the comment id and change made.
```

Quick walkthrough:

1. Run `npx --yes tunelito ./site --agent codex --no-tunnel --open`.
2. Select text in the browser and leave a comment.
3. The local worker invokes Codex for new unresolved comments.
4. Codex edits the source HTML or Markdown file named by a page-scoped comment's `page: ...` context, or the relevant files for a site-scoped comment.
5. If Codex returns `needs_followup`, Tunelito sends the same comment again with completed and remaining tasks on the next pass.
6. Tunelito reloads connected browsers after saved HTML changes, deferring the reload when a reviewer has an open comment composer so unsubmitted text is not lost.

## Live Mode

`--live` is for in-the-meeting collaboration. Comments, cursors, and selection highlights stay in memory and disappear when the local server exits.

Tunelito uses WebRTC data channels between browsers when possible. The authenticated WebSocket connection remains open for room membership, WebRTC signaling, file-change reloads, and fallback relay if a peer-to-peer connection cannot be established. Tunelito does not configure third-party STUN or TURN servers, so some remote networks will use the relay fallback.

## Pre-call Checklist

Before sharing a live session:

1. Run `npx --yes tunelito ./page.html`.
2. Wait for the `Public:` URL.
3. Open that URL on your phone.
4. Select text and submit a short comment.
5. Add a short page note or site note from the comments panel.
6. Confirm the terminal logs `Comment from ...`.
7. Confirm `<page>.comments.md` contains the comment with `scope: ...`.
8. Edit and save the source file; the phone should reload.

For an ephemeral call, run with `--live` and skip the markdown-file check.

## Packaging a Release Tarball

```bash
npm run ci
npm pack
npm install -g ./tunelito-0.5.0.tgz
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
- Mermaid is served from the installed Tunelito package rather than a CDN, stays behind the same review-key gate, uses `securityLevel: "strict"`, disables HTML labels and diagram click behavior, and preserves escaped source in a collapsible fallback. Diagram authors can add Mermaid `accTitle` and `accDescr` lines for accessible SVG labels.
- WebRTC peer-to-peer connections depend on browser and network support; the WebSocket relay keeps `--live` usable when direct peer connections fail.
