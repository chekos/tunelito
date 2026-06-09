---
name: tunelito
description: >-
  Use Tunelito to turn a local HTML file or folder of HTML files into a
  temporary live review room: it serves the page(s), injects a comment UI,
  syncs annotations over WebSocket, and shares them via a Cloudflare Tunnel.
  Fire this skill when a user wants to share an HTML page or static site for
  feedback during a call or meeting, collect comments or annotations on
  rendered HTML, run a real-time/ephemeral review (--live), review sensitive
  HTML locally without exposing it (--no-tunnel), label themselves to
  reviewers (--owner), auto-apply review comments with a local coding agent
  (--agent codex|claude), or act on a *.comments.md inbox that Tunelito wrote.
  Triggers on "share this HTML for review", "let my designer comment on this
  page", "review this site on a call", "apply the comments in
  site.comments.md". Not for reviewing code/PRs or writing code comments.
license: MIT
compatibility: Requires Node.js 22+. Public sharing uses Cloudflare Tunnel.
metadata:
  package: tunelito
  install: npx --yes tunelito ./page.html
---

# Tunelito

Tunelito (v0.8.1) serves a local HTML file or folder of HTML files as a
temporary review room. It injects a same-origin comment client into the
*served response* (the source files on disk are never rewritten for this),
syncs annotations over WebSocket, optionally exposes the local server through
a Cloudflare Tunnel, and live-reloads connected browsers when source files
change. Reviewers select text to comment, or leave page/site notes.

Pick the command from the intent table, run it, then tell the user which
printed URL to share. The CLI prints `Local:`, `Comments:`, `Access:`, and
`Public:` lines on startup.

## Pick the command (intent -> command)

| User wants | Command | Share |
| --- | --- | --- |
| Designer/teammate to comment on a page during a call | `tunelito ./index.html` | the **Public:** URL |
| Same, for a folder of pages (mini-site) | `tunelito ./site` | the **Public:** URL |
| Label who they are in the room | add `--owner "Sergio"` | Public: URL |
| Ephemeral, in-meeting only, nothing saved | `tunelito ./index.html --live` | Public: URL |
| Sensitive content — do not expose it | `tunelito ./page.html --no-tunnel --open` | nothing; opens locally |
| Auto-apply comments people leave, on a call | `tunelito ./site --agent claude` (or `--agent codex`) | Public: URL |
| Gate which comments the agent acts on | add `--owner "Sergio" --agent-policy owner-or-mention --agent-trigger "@agent"` | Public: URL |
| Act on a `*.comments.md` inbox Tunelito already wrote | no command — **edit the HTML files** (see below) | — |

Defaults that matter: the server binds `127.0.0.1`, picks the first free port
from 4317, persists comments to `<page-or-folder>.comments.md` beside the
source, and the shared URL is keyed. Override with `--port`, `--host`,
`--out`. Run `tunelito --help` to confirm current flags before relying on any.

## How sharing and access work

The `Public:` URL contains a `tunelito_key`. That key is **bearer access**:
anyone with the full link can view *and* comment, no login. The first valid
request gets a short-lived HTTP-only cookie. So treat the link like a
password — share it only with the people who should be in the review. Don't
post it in a public channel.

`--owner "<name>"` adds a separate owner key to the `Local:` URL and labels
that person's comments. It is a session label for "who am I", not stronger
security — it does not lock out other reviewers.

`--no-auth` removes the key gate entirely. Only suggest it for a local demo
or a fully trusted network; on a tunnel it makes the page open to anyone who
finds the URL.

## Saved vs ephemeral comments

By default comments persist to Markdown beside the source — `./site` writes
`site.comments.md`, `./page.html` writes `page.html.comments.md` (or use
`--out <path>`). A folder shares **one** inbox: page-scoped comments show
only on their page; site-scoped notes show on every page. This file is the
durable record and the hand-off to a coding agent.

`--live` keeps everything in memory: **nothing is written to disk** and a
restart loses all comments. Use it only when the user explicitly wants a
throwaway in-meeting session. `--live` also disables the agent worker.

## Auto-applying comments with a local agent (--agent)

`--agent claude` runs `claude -p` with edit permissions on the served folder;
`--agent codex` runs `codex exec` in workspace-write mode. As reviewers leave
persisted comments, the worker reads the inbox and edits the served files to
satisfy them, then records outcomes in `.tunelito/agent/state.json`.

This is **trusted-session local code execution**: every reviewer comment
becomes an instruction to a process that can edit files on the user's
machine. Before enabling it, confirm the user trusts everyone who has the
link. For an open-ish call, gate it: set `--owner`, then
`--agent-policy owner-or-mention --agent-trigger "@agent"` so only the
owner's comments or ones containing `@agent` reach the worker. (Mention
policies require a non-`all` trigger.) Never combine `--agent` with `--live`.

Full worker model — JSON output contract, every status, multi-pass behavior,
custom commands, and tuning flags — is in `reference/agent-worker.md`.

## Acting on a `*.comments.md` inbox

When a user says "apply the comments in `site.comments.md`," that is the
intended workflow: **read the inbox and edit the HTML files to satisfy each
comment.** Tunelito only avoids rewriting files to inject *its own* client;
it does not stop you from editing HTML to act on review feedback. Do not
refuse to edit the HTML.

Each comment is a Markdown section:

- `## <Name> at <UTC>` header.
- An optional `> selected quote` (the highlighted text). Notes labeled
  "Page note" / "Site note" have no quote.
- The comment body.
- An italic context line carrying: `scope` (page|site), `page` (`/path.html`),
  `path` (CSS selector), text offset, `id` (`c_...`), and `author role: owner`
  when `--owner` was set.

Use `scope` + `page` to find the right file, the quote + selector to locate
the spot, and keep the `id` straight if you summarize back. If the exact
quoted text changed since the comment was made, the highlight may not
reattach in the UI, but the comment stays in the Markdown — work from the
text, not the highlight.

## What is and isn't annotatable

Reviewers can only annotate real DOM text. Canvas, video, images, and
cross-origin iframes can't be commented on — if a user wants feedback on
those, tell them to add nearby text or describe it in a page note. Strict
in-page CSP `<meta>` tags are stripped from the served response so the
comment client can run; this affects only the served copy, not disk.

## Critical rules

| Don't | Why it bites |
| --- | --- |
| Treat the `Public:` URL as private/safe | It's bearer access — anyone with the link can view and comment. |
| Suggest `--no-auth` on a tunnel | Removes the only gate; the public URL becomes open to all. |
| Use `--live` when the user wants a record | Nothing is saved; a restart loses every comment, and `--agent` won't run. |
| Enable `--agent` for an untrusted audience | Reviewer comments become commands to a local file-editing process. |
| Refuse to edit HTML when acting on a `*.comments.md` inbox | That edit is the whole point; only Tunelito's client injection leaves files untouched. |
| Invent or guess a flag | Only the documented flags exist; run `tunelito --help` to confirm. |

When unsure which flags exist or their current defaults, run
`tunelito --help` rather than guessing.

