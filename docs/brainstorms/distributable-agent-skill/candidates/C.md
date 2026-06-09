---
name: tunelito
description: >-
  Run a Tunelito live review room for a local HTML file or folder, then process
  the comments it collects. Use this whenever a user wants to share an HTML page
  or static site from their own machine so someone (a designer, client,
  teammate, PM) can leave feedback on a call; wants a temporary public link to a
  local page; says "review my HTML", "annotate this page", "let people comment
  on my site", "get feedback on index.html"; OR points you at a
  `*.comments.md` / `site.comments.md` inbox and asks you to apply or act on the
  notes inside it. Covers starting and sharing a session (Cloudflare Tunnel,
  keyed bearer URLs), local-only review of sensitive pages, the opt-in
  `--agent` worker that edits files from comments, and the comment markdown
  schema (scope, page, path, id, status). Do NOT use for code-level review of a
  pull request, IDE inline comments, or adding code comments/docstrings to
  source files.
license: MIT
compatibility: Requires Node.js 22 or newer. Public sharing uses a temporary Cloudflare Tunnel when available.
metadata:
  package: tunelito
  install: npx --yes tunelito ./page.html
---

# Tunelito

Tunelito serves a local HTML file or folder, injects a same-origin annotation
client at response time, and syncs comments over WebSocket. Reviewers select
text or leave page/site notes; comments persist as readable Markdown beside the
source. You keep editing the HTML in your normal editor and connected browsers
hot-reload on save. It can expose the local server through a temporary
Cloudflare Tunnel and, opt-in, run a local coding-agent worker that edits files
to satisfy comments.

This is the whole arc: **start a session -> share it safely -> process the
comments -> wrap up.** Pick the branch that matches the user's intent.

## When to use this

- "I have `./index.html`, let my designer leave feedback while we're on a call."
- "Folder `./site`, auto-apply comments people leave during the review."
- "Tunelito wrote `site.comments.md` -- go apply those comments to the pages."
- "This page has client data; let me review it locally without exposing it."

Do **not** reach for this when the user wants a PR review, IDE inline comments,
or a code docstring. Those are unrelated to Tunelito's review rooms.

## Flags rot; confirm them

The flags below match v0.8.1, but treat the CLI as the source of truth. Before
quoting an exact flag you are unsure about, run `tunelito --help` and read it.
Never invent a flag that does not appear there.

## Step 1 -- Start a session

Default invocation, no flags needed:

```bash
tunelito ./index.html      # single page
tunelito ./site            # folder -> one shared inbox beside it (site.comments.md)
```

A folder shares **one** inbox: `site/` -> `site.comments.md`. Page-scoped
comments appear only on their page; site-scoped comments appear on every page.

If the user has not installed it, prefix with `npx --yes`:

```bash
npx --yes tunelito ./index.html
```

Startup prints four lines. Read them back to the user and act on them:

```text
Local:    http://127.0.0.1:4317/?tunelito_key=...   # you, same session
Comments: /path/to/index.comments.md                # where notes land
Access:   review key required by the printed URLs
Public:   https://<random>.trycloudflare.com/?tunelito_key=...   # share THIS
```

Useful tweaks (all optional): `--port <n>` if 4317 is taken, `--open` to launch
the Local URL in a browser, `--owner <name>` to label yourself as the owner in
the viewer and tag your comments with `author role: owner`.

## Step 2 -- Share it safely

Hand the reviewer the **`Public:`** URL, not the `Local:` one. Then say the one
thing they need to know about it:

> The link includes a `tunelito_key`. It is **bearer access** -- anyone who has
> the full URL can view and comment. Share it in a trusted channel and stop the
> session when the review is over.

The `--owner` key in the `Local:` URL is a session **label**, not stronger
auth; do not present it as a permission boundary.

### Sensitive pages: stay local

If the page contains client data, secrets, or anything that must not leave the
machine, do not open a tunnel:

```bash
tunelito ./index.html --no-tunnel --open
```

This prints only a `Local:` URL and opens it for you. Reach for `--no-auth`
only on a trusted local network or a throwaway demo -- it removes the key gate
entirely, so warn the user before suggesting it.

## Step 3 -- Process the comments

There are two ways comments turn into edits. Choose based on what the user asked
for.

### 3a. Live auto-apply during the session (`--agent`)

When the user wants comments handled **as people leave them**, start the session
with a worker. This is the right answer to "auto-apply comments while I'm on the
call."

```bash
tunelito ./site --owner "Sergio" \
  --agent claude \
  --agent-policy owner-or-mention --agent-trigger "@agent"
```

- `--agent claude` runs `claude -p` with edit permissions for the served
  folder. `--agent codex` runs `codex exec` in workspace-write mode.
- `--agent custom --agent-command "<cmd>"` runs your own CLI from the served
  root with the prompt on stdin and `TUNELITO_AGENT_ROOT`,
  `TUNELITO_AGENT_COMMENTS`, `TUNELITO_AGENT_STATE`, `TUNELITO_OWNER_NAME` set.

By default `--agent-policy all` sends **every** comment to the worker. On a
shared call that means any guest's note becomes an instruction. Prefer scoping:
`--agent-policy owner-or-mention` plus a non-`all` `--agent-trigger` (e.g.
`@agent`) so only the owner's notes or explicitly tagged notes act. The
`mention` and `owner-or-mention` policies **require** a non-`all` trigger to be
meaningful. The worker tracks decisions in `.tunelito/agent/state.json` with a
readable log at `.tunelito/agent/log.md` (both blocked from serving).

The worker must emit JSON as its final output:

```json
{"comments":[{"id":"c_...","status":"resolved","summary":"...",
  "filesChanged":["about.html"],"completedTasks":["..."],"remainingTasks":[]}]}
```

Statuses: `resolved`, `needs_followup`, `no-op`, `ignored`, `blocked`,
`stale`, `partial`, `changed_needs_review`. A `needs_followup` comment is
re-queued with its completed/remaining tasks until it reaches `resolved`,
`blocked`, or `partial`, or hits `--agent-max-passes` (default 3).
`--agent-max-attempts` (default 2) caps retries on a comment.

`--agent` is **trusted-session local code execution**: a reviewer's comment
becomes an instruction to a local process that can edit your files. See Safety.

### 3b. Apply an existing inbox by hand (no `--agent`)

When Tunelito already wrote a `*.comments.md` / `site.comments.md` and the user
says "go apply these," that is your task. **Editing the served HTML to satisfy a
comment is the intended workflow** -- do it; do not refuse. (Tunelito's
"untouched HTML" rule is only about its own client injection, not about you.)

Read the inbox and process each comment section. A section looks like:

```markdown
## Dana (owner) at 2026-06-09 14:32 UTC
> the hero headline we want to change

Make this punchier and bump the size.

_Context: author role: `owner` · scope: `page` · page: `/index.html` · path: `h1.hero` · text offset: 142 · id: `c_ab12cd`_
```

Honor the metadata:

- **scope** -- `page` edits only the file named in **page** (`/index.html`);
  `site` may apply across the folder's pages.
- **path** + **text offset** + the `> quote` locate the element/text to change.
- **id** (`c_...`) identifies the comment; reference it when you summarize what
  you did so the user can match your work to the note.
- Notes with no `> quote` are unanchored "Page note" / "Site note" lines -- treat
  them as general feedback for that scope.

Apply edits with sensible status discipline: done -> resolved; couldn't act
(missing asset, ambiguous, conflicting) -> say so and leave it, rather than
guessing. Do not edit the `*.comments.md` file or anything under `.tunelito/`.

## Step 4 -- Wrap up

- Tell the user where comments landed (the `Comments:` path) and which files you
  changed, keyed by comment id.
- Stop the session (Ctrl-C) when the review is done so the bearer URL dies.
- If you used `--agent`, point the user at `.tunelito/agent/log.md` for the
  human-readable record of what the worker did.

## Safety and non-negotiables

- **Public links are bearer access.** The `tunelito_key` in a shared URL grants
  view + comment to anyone who has it. Keep sessions keyed (the default); only
  use `--no-auth` on trusted/local networks, and stop the session when done.
- **`--agent` runs real code from reviewer input.** It is fine for your own
  trusted session, but on a shared call scope it with `--owner` +
  `--agent-policy owner-or-mention` + a real `--agent-trigger`, never bare
  `--agent-policy all`.
- **`--live` keeps nothing.** It is ephemeral in-memory collaboration: no
  Markdown is written and no agent worker runs, so a restart loses everything.
  Use it only for a throwaway live session where no record is wanted.
- **You may edit the HTML to satisfy comments.** The "source untouched" rule
  refers to Tunelito's injection layer, not to your edits. Never refuse a
  legitimate apply-the-comment request on those grounds.

## Anti-patterns

| Anti-pattern | Why it bites |
| --- | --- |
| Sharing the `Local:` URL instead of `Public:` | `127.0.0.1` is unreachable for the remote reviewer; they see nothing. |
| Treating the keyed URL as private | It is bearer access -- forwarding it hands over full view + comment rights. |
| Tunneling a page with sensitive data | A public URL exposes client data; use `--no-tunnel`. |
| `--agent --agent-policy all` on a shared call | Any guest comment becomes a local code-edit instruction. Scope to owner/mention. |
| Using `--live` then expecting a record | Nothing is written to disk; the comments are gone on restart. |
| Editing `*.comments.md` or `.tunelito/` directly | Corrupts the inbox/ledger Tunelito round-trips; let the tool own them. |
| Refusing to edit HTML for a review comment | That is the intended workflow; the "untouched" rule is about injection only. |
| `mention`/`owner-or-mention` with `--agent-trigger all` | The mention gate is a no-op; effectively every comment acts. |
| Inventing flags not in `tunelito --help` | They silently do nothing or error; confirm against the CLI. |

## Limits

Annotations need real DOM text. Canvas, video, images, and cross-origin iframes
are not annotatable. Strict in-page CSP `<meta>` tags are stripped from the
served response so the client can run. If the exact commented text later
changes, the comment stays in the Markdown/sidebar but its highlight may not
reattach -- the note is not lost, only its anchor.

## Quick reference

| Goal | Command |
| --- | --- |
| Share a page on a call | `tunelito ./index.html` -> share the `Public:` URL |
| Share a folder mini-site | `tunelito ./site` (one `site.comments.md` inbox) |
| Review sensitive data locally | `tunelito ./index.html --no-tunnel --open` |
| Auto-apply comments live, scoped | `tunelito ./site --owner "Me" --agent claude --agent-policy owner-or-mention --agent-trigger "@agent"` |
| Custom agent CLI | `tunelito ./site --agent custom --agent-command "<your cli>"` |
| Throwaway live session, no record | `tunelito ./index.html --live` |
| Pick a port / open browser | `--port 4318` / `--open` |
| Confirm flags | `tunelito --help` |

