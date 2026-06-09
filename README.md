# Tunelito

[![CI](https://github.com/chekos/tunelito/actions/workflows/ci.yml/badge.svg)](https://github.com/chekos/tunelito/actions/workflows/ci.yml)

Tunelito turns any local HTML file or folder of HTML files into a temporary live review room.

Run one command, share the printed URL on a call, and reviewers can select text, leave page notes, or leave site-wide notes. You keep editing the HTML in your normal editor; connected browsers reload when files change. Comments are saved as readable markdown beside the page or folder by default, or kept ephemeral with `--live`.

Tunelito is local-first: your files stay on your machine, the public URL is a temporary tunnel to your laptop, and edit access never leaves your editor.

## Quickstart

Tunelito requires Node.js 22 or newer.

```bash
npx --yes tunelito ./page.html
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

Each comment includes a scope, page path, and visible comment id, so Claude Code, Codex, or another local agent can watch that file, apply edits to the matching HTML file or the whole folder when a comment is site-wide, and continue larger comments across bounded follow-up passes.

To let a local agent handle comments while Tunelito runs:

```bash
npx --yes tunelito ./site --agent codex
```

Use `--agent claude` for Claude Code, or `--agent-command "<your command>"` for another local CLI. Tunelito sends prompts to that command on stdin and tracks handled comment IDs in `.tunelito/agent/state.json`.

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

Share the `Public:` URL with the person on your call. Open the `Local:` URL yourself if you want to watch the same session.

To label your own comments as the session owner:

```bash
tunelito ./page.html --owner "Chekos"
```

Tunelito assigns everyone else a random editable display name, so comments from multiple reviewers are easy to tell apart.

For local-only work:

```bash
tunelito ./page.html --no-tunnel --open
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
- Keep or edit their assigned display name before commenting.
- See other comments appear live.
- In `--live`, see peer cursors and live selection highlights when the browser can connect peer-to-peer.
- In persistent sessions, open the generated markdown comments file from the panel.

## What You Control

- The source HTML files remain untouched.
- Edits happen in your editor only.
- Saved HTML changes trigger a live reload in connected browsers.
- Comments persist to `<page-or-folder>.comments.md` unless you choose another path with `--out`.
- `--live` keeps comments in memory only; the session disappears when the local server exits.

## CLI

```text
Tunelito 0.8.1

Usage: tunelito <page.html|folder> [options]
       tunelito skill show

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page-or-folder>.comments.md)
  --owner <name>        Assign this editable owner name to the local viewer
  --live                Use ephemeral live collaboration mode; do not write comments to disk
  --agent <codex|claude|custom>
                        Run a local coding-agent worker for persistent comments
  --agent-command <cmd> Custom shell command for --agent custom; prompt is sent on stdin
  --agent-interval <s>  Agent fallback polling interval in seconds (default: 120)
  --agent-policy <mode> Which comments the agent handles: all|mention|owner|owner-or-mention (default: all)
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
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --no-auth             Disable the generated review-key URL gate
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show this help

Commands:
  skill show            Print the distributable Tunelito agent skill (SKILL.md)
                        for a coding agent to install
```

## Agent Skill

Tunelito ships an agent skill that teaches a coding agent (Claude Code, Codex, Cursor, and others) how to drive Tunelito: starting and sharing a review session safely, keeping sensitive pages local, and applying the comments from a `*.comments.md` inbox.

Print it and let your agent install it however it prefers:

```bash
tunelito skill show
```

For Claude Code, for example:

```bash
tunelito skill show > .claude/skills/tunelito/SKILL.md
```

Or just tell your agent: "run `tunelito skill show` and install the skill it prints." The same skill is published at `docs-site/skill.md` and described by `docs-site/.well-known/agent-skills/index.json` for `npx skills`-style discovery.

## How It Works

Tunelito serves the HTML from disk and injects a small same-origin annotation client into the response. For folder targets, every served `.html` or `.htm` page gets the client and shares one comments inbox. Page-scoped comments appear only on their current page; site-scoped comments appear on every page in that folder session. The injected client handles selection, unanchored page/site notes, highlights, live sync, and reload notices. The original HTML files are not modified.

The server also:

- serves sibling assets relative to the HTML file, or non-hidden files within the selected folder
- writes comments to markdown atomically
- restores prior comments from hidden Tunelito metadata in that markdown
- can run an opt-in local agent worker against persistent comments
- relays WebRTC signaling and live fallback events in `--live`
- starts `cloudflared tunnel --url <local-url>` when available
- falls back to `npx cloudflared@latest` when `cloudflared` is not installed

Set `TUNELITO_CLOUDFLARED_PACKAGE=cloudflared@<version>` to pin the fallback package used by `npx` while keeping the default behavior on `cloudflared@latest`.

## Access Model

Shared sessions include a generated `tunelito_key` in the printed URLs by default. The key is bearer access: anyone with the full URL can view the page and leave comments. The first valid request sets a short-lived, HTTP-only cookie so page assets and WebSocket sync keep working.

When `--owner <name>` is set, the printed `Local:` URL also includes a separate owner key. Comments from that owner session are marked as owner-authored, and the local agent worker receives the owner name and each comment's author role. The owner key is a session label, not stronger authentication; anyone with the full owner URL can comment as the owner.

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

Tunelito also stores hidden metadata comments so the live session can be restored after a restart.

In `--live`, comments are not written to markdown and are not restored after restart.

## Agent Comment Loop

The persistent comments file is a practical inbox for Claude Code, Codex, or another local coding agent. Folder comments include `scope: ...`, `page: ...`, and `id: ...` in their visible context. When `--owner` is set, the worker prompt also includes the owner name and each comment's `authorRole`, so host instructions can ask the agent to prefer owner comments or wait for owner approval.

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

Use `--agent-policy owner` when only owner-authored comments should reach the worker:

```bash
tunelito ./site --owner "Chekos" --agent codex --agent-policy owner
```

For the recommended owner-led workflow, let owner comments through automatically and let visitors opt in with a marker:

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

Handled comments are recorded in `.tunelito/agent/state.json` with statuses like `resolved`, `needs_followup`, `no-op`, `ignored`, `blocked`, `partial`, and `stale`. That state file prevents the worker from repeating the same edit after the source text changes and the original highlight becomes stale, while still allowing a large inline, page, or site comment to continue from its saved remaining tasks. A readable run log is written to `.tunelito/agent/log.md`; Tunelito blocks both files from static serving and ignores `.tunelito` ledger writes for browser reloads.

Treat `--agent` as trusted-session behavior: reviewer comments become instructions to a local process that can edit files.

Manual agent prompt:

```text
Monitor site.comments.md every 2 minutes. For each new actionable comment, edit the matching HTML file, then summarize the comment id and change made.
```

Quick walkthrough:

1. Run `npx --yes tunelito ./site --agent codex --no-tunnel --open`.
2. Select text in the browser and leave a comment.
3. The local worker invokes Codex for new unresolved comments.
4. Codex edits the source HTML file named by a page-scoped comment's `page: ...` context, or the relevant files for a site-scoped comment.
5. If Codex returns `needs_followup`, Tunelito sends the same comment again with completed and remaining tasks on the next pass.
6. Tunelito reloads connected browsers after saved HTML changes.

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
8. Edit and save the HTML file; the phone should reload.

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
- WebRTC peer-to-peer connections depend on browser and network support; the WebSocket relay keeps `--live` usable when direct peer connections fail.
