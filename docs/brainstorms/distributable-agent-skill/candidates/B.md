---
name: tunelito
description: >-
  Use Tunelito to turn a local HTML file or folder into a temporary live review
  room, AND to process the comments Tunelito leaves behind. Fires when a user
  wants to review, annotate, or share an HTML page or site from their machine,
  get a designer or teammate to leave feedback on a call, or expose a local page
  via a link. CRUCIALLY, fires when Tunelito has written a *.comments.md inbox
  (e.g. site.comments.md, index.html.comments.md) and the user says "apply the
  comments", "go fix the feedback", "act on the review notes", or "process the
  inbox" WITHOUT having run --agent. In that case this skill teaches the agent
  to read each comment's scope/page/id, edit the correct HTML file(s) to satisfy
  the comment, and report sane statuses. Covers flags like --agent, --no-tunnel,
  --no-auth, --owner, --agent-policy, --agent-trigger, and the keyed bearer link.
  Does NOT apply to code-comment docstrings, GitHub PR review, or unrelated chat.
license: MIT
compatibility: Requires Node.js 22 or newer. Public sharing uses Cloudflare Tunnel when available.
metadata:
  package: tunelito
  install: npx --yes tunelito ./page.html
---

# Tunelito

Tunelito serves a local HTML file or a folder of HTML files as a temporary
live review room. It injects a comment client into each served response (the
source files on disk are never rewritten to do this), syncs comments over
WebSocket, optionally exposes the local server through a Cloudflare Tunnel, and
reloads open browsers when the source changes. Reviewers select text and leave
comments; Tunelito appends each comment to a Markdown **inbox** beside the
source.

The highest-value thing you can do with Tunelito is **process that inbox**:
when a session ends, the user often opens you (their coding agent) and says
"apply the comments." That loop is the star of this skill. Start there if a
`*.comments.md` file already exists; otherwise use "Starting a session" to get
one going.

## Find current truth first

Flags change between versions. Before relying on any flag, confirm it:

```bash
tunelito --help
tunelito --version
```

This skill is accurate for v0.8.1. If `--help` disagrees, trust `--help`.

---

## The inbox loop (process *.comments.md)

This runs when **no `--agent` worker is running** and the user asks you to act
on review feedback. You are the worker. Editing the HTML to satisfy a comment
is the intended workflow — do it.

### 1. Locate the inbox

The inbox lives beside the source: a single file `<page-or-folder>.comments.md`
(e.g. `index.html` -> `index.html.comments.md`; a folder `site/` ->
`site.comments.md`), unless the user passed `--out <path>`. A **folder shares
one inbox** for the whole site. Read it.

If the user used `--live`, there is **no inbox** — `--live` writes nothing to
disk. Say so and stop; nothing to process.

### 2. Read each comment's anchor

Each comment is one Markdown section. A hidden HTML metadata line
(`<!-- tunelito-comment: ... -->`) precedes each section — leave it alone; it is
how Tunelito restores sessions. The visible shape is:

```markdown
## Dana at 2026-06-09T14:03:11Z
> The hero headline text they selected
Make this headline punchier and bump the contrast.
_Context: scope: `page` · page: `/about.html` · path: `main > h1` · text offset: 412 · id: `c_lr8...`_
```

Read the `_Context:_` line as the routing instructions for each comment:

| Field | Meaning | What you do with it |
| --- | --- | --- |
| `scope: page` | Applies to one page only | Edit only that page's file |
| `scope: site` | Applies across the whole site | Find every relevant file; may touch several |
| `page: /about.html` | Which served page | Maps to that file under the served root |
| `path: main > h1` | CSS selector of the anchored element | Locate the element to change |
| `text offset: 412` | Char offset of the selection | Disambiguates which match |
| `id: c_...` | Stable comment id | Use it in your status report |
| `author role: owner` | Left by the `--owner` viewer | Weight it as the page owner's intent |

A `> quote` line is the **exact selected text** — your strongest anchor; match
it in the HTML. Comments with no quote are **page notes** or **site notes**
(rendered as `_Page note (no selected text)._` / `_Site note..._`) and apply to
the whole page or whole site rather than one element.

### 3. Edit the right file

- **Page-scoped** (`scope: page`, `page: /about.html`): open the file the page
  maps to under the served root and edit only that file. The served path `/`
  usually maps to `index.html`.
- **Site-scoped** (`scope: site`): the comment applies everywhere. Make the
  change in each file it touches (e.g. a footer in every page, or a shared
  partial/CSS if the site uses one). Site notes with no quote are global intent.
- Use the `> quote` + `path` to find the exact element. If the quote no longer
  matches verbatim, the highlight may have drifted but the comment is still
  valid — locate the current equivalent element and act on the **intent**.

Edit the source HTML directly. Tunelito's "source stays untouched" rule is only
about its *injection layer* not rewriting your file to add the client — it does
**not** forbid you from changing the HTML to address feedback. That is the job.

### 4. Decide act vs. no-op per comment

Borrow Tunelito's own status vocabulary so your report is legible and you avoid
re-doing work:

| Status | Use when |
| --- | --- |
| `resolved` | You made the change and it satisfies the comment |
| `partial` | You did part of a multi-step comment; rest is out of reach now |
| `needs_followup` | More passes needed; note completed vs remaining tasks |
| `no-op` | Already satisfied in the current HTML; nothing to change |
| `ignored` | Out of scope, chit-chat, or not actionable as an edit |
| `blocked` | Can't act without info/assets/permission you don't have |
| `stale` | Refers to content that no longer exists |
| `changed_needs_review` | You changed something but want a human to confirm |

When in doubt between editing and skipping: if the comment names a concrete
change to visible page content, act. If it asks for a decision, an asset you
don't have, or something outside the served files, return `blocked`/`ignored`
with a one-line reason instead of guessing.

### 5. Multi-pass for big comments

A broad comment ("tighten the whole landing page") won't finish in one edit.
Do a focused pass, record what you **completed** and what **remains**, and
continue in another pass. This mirrors the worker's `needs_followup` behavior,
which retries with completed/remaining task lists until done or a pass cap. Keep
each pass small and verifiable.

### 6. Report back

Summarize per comment by `id`: status, a one-line summary, and which files you
changed. This lets the user re-run Tunelito and see the feedback addressed. You
do **not** write to `*.comments.md` yourself — that file is owned by Tunelito
(treat it as read-only). Just edit the HTML and report.

---

## Starting a session

Pick the command from intent. Default to the simplest that fits.

| User intent | Command |
| --- | --- |
| Share a page so someone leaves feedback now | `tunelito ./index.html` then share the `Public:` URL |
| Share a multi-page site | `tunelito ./site` |
| Review locally, do NOT expose it | `tunelito ./page.html --no-tunnel --open` |
| Let comments auto-apply during a call (Claude) | `tunelito ./site --agent claude` |
| Same, with Codex | `tunelito ./site --agent codex` |
| Label who the owner is | add `--owner "Sam"` |

After startup, Tunelito prints `Local:`, `Comments:`, `Access:`, and `Public:`
lines. **Share the `Public:` URL** — it carries the review key. The
`Comments:` line is where the inbox will land.

```bash
tunelito ./index.html
# Local:    http://127.0.0.1:4317/?tunelito_key=...
# Comments: ./index.html.comments.md
# Public:   https://something.trycloudflare.com/?tunelito_key=...
```

### Auto-applying comments during a session (--agent)

`--agent claude` runs `claude -p` and `--agent codex` runs `codex exec` against
the served folder, turning each incoming comment into edits live. `--agent
custom --agent-command "<cmd>"` runs your own shell command from the served root
with the prompt on stdin. There is no worker in `--live`.

This is **local code execution driven by reviewer comments**: anyone with the
shared link can leave a comment that becomes an instruction to a process that
edits files. For a public session, gate it:

```bash
tunelito ./site --agent claude --owner "Sam" \
  --agent-policy owner-or-mention --agent-trigger "@agent"
```

Now only the owner's comments or comments containing `@agent` reach the worker.
Mention-based policies (`mention`, `owner-or-mention`) **require** a non-`all`
`--agent-trigger`. Useful tuning: `--agent-instructions "<text>"` to append
guidance, `--agent-max-passes <n>` for big comments, `--agent-max-attempts <n>`
to cap retries. The worker keeps a ledger at `.tunelito/agent/state.json` and a
readable log at `.tunelito/agent/log.md` (both blocked from being served).

---

## Critical rules

- **Keyed links are bearer access.** The `tunelito_key` in shared URLs means
  *anyone with the full URL can view and comment* — there is no per-user login.
  Tell the user that when they share. `--owner` adds a session label, not
  stronger auth.
- **Sensitive content stays local.** For private data, use `--no-tunnel`
  (no public link) and `--open`. Only use `--no-auth` on a trusted local
  network/demo — it removes the key gate entirely.
- **`--agent` is trusted-session local execution.** Don't enable it for
  untrusted reviewers without `--agent-policy` + `--agent-trigger` gating.
- **`--live` has no inbox.** It's ephemeral, in-memory, no Markdown, no worker,
  and cannot restore after restart. Don't use it when the user wants to act on
  comments later.
- **Don't edit `*.comments.md`, `.env*`, or `.tunelito/`.** The inbox and ledger
  are Tunelito-owned; you act on the HTML, not on those files.
- **Editing the HTML to satisfy a comment is correct.** Tunelito never rewrites
  the source to inject its client, but acting on feedback by editing the source
  is the whole point. Never refuse a review edit on "don't touch the source"
  grounds.

## Limits to set expectations

- Only real DOM text can be annotated — canvas, video, images, and cross-origin
  iframes can't carry comments.
- Strict in-page CSP `<meta>` tags are stripped from the served response so the
  client can run; this affects only what Tunelito serves, not your file.
- If commented text changes, the comment stays in the inbox/sidebar but its
  highlight may not reattach. The comment is still valid — act on its intent.

## Does NOT apply

Adding a code/docstring comment to a function, reviewing a GitHub pull request,
or general chat about "comments" unrelated to a served HTML page. Don't trigger
on those.

