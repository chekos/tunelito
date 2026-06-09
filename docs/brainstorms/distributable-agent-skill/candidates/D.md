---
name: tunelito
description: >-
  Use Tunelito to turn a local HTML file or folder into a temporary live review
  room: it serves the page(s), injects a comment client at response time
  (without rewriting the source), syncs comments over WebSocket, optionally
  exposes the server via a Cloudflare Tunnel, and can run a local coding-agent
  worker that applies reviewer comments. Trigger this skill when a user wants to
  share, serve, review, annotate, comment on, or collect feedback on a local
  .html page or a folder/mini-site — e.g. "let my designer leave feedback on
  index.html while we're on a call", "spin up a review room for ./site",
  "auto-apply the comments people leave", or "review this page locally without
  exposing it". Also trigger when a user points at a *.comments.md inbox and asks
  to apply, process, or act on the comments. Do NOT trigger for reviewing a
  pull request, code review, or adding code/docstring comments to source files.
license: MIT
compatibility: Requires Node.js 22 or newer. Public sharing uses a Cloudflare Tunnel when available.
metadata:
  package: tunelito
  install: npx --yes tunelito ./page.html
---

# Tunelito

Tunelito serves a local HTML file (or a folder of HTML files) as a temporary
live review room. It injects a same-origin comment client into the served
response, syncs comments over WebSocket, optionally publishes the server through
a Cloudflare Tunnel, and reloads connected browsers when source files change.
Reviewers select text and leave inline comments, page notes, or site notes;
those persist to a Markdown inbox beside the source.

Invocation is always `tunelito <page.html|folder> [options]`. Use
`npx --yes tunelito ...` if it is not installed globally.

## Why this skill leads with invariants

Tunelito hands out a public, keyed URL and can run a local process that edits
files based on what reviewers type. Two mistakes cause real harm: exposing data
that should stay private, and letting untrusted reviewers drive a local agent.
The rules below exist to prevent exactly those. Read them first; the operating
guidance after assumes you have internalized them.

## Critical rules — Never / Always

**Never**

| Don't | Why it bites |
| --- | --- |
| Add `--no-tunnel` is NOT optional for sensitive pages — never publish a tunnel for pages with private/client data. | The `Public:` URL is bearer access: anyone with the full link can read and comment. There is no per-person login. |
| Never tell the user the keyed URL is "secure" or "authenticated per person". | The `tunelito_key` is a shared bearer token in the URL. Whoever holds the link is in. Describe it as a shareable link, not auth. |
| Never enable `--agent` / `--agent-command` for a session shared with untrusted reviewers without gating. | `--agent` is trusted-session local code execution: a reviewer's comment becomes an instruction to a local process that can edit files. Gate it with `--owner` + `--agent-policy owner-or-mention --agent-trigger "@agent"`. |
| Never combine `--agent` with `--live`. | `--live` is ephemeral and writes nothing to disk, so there is no persistent inbox for the worker to act on. The combination has no effect by design. |
| Never use `--no-auth` for a tunneled or non-trusted-network session. | It removes the URL key gate entirely, exposing the page to anyone who can reach the host. |
| Never edit, rename, or hand-write `*.comments.md` to "fix" the system. | That file is Tunelito's data store; it round-trips comment state. Acting on comments means editing the **source HTML**, not the inbox. |

**Always**

| Do | Why |
| --- | --- |
| Always share the printed `Public:` URL (not `Local:`) when the reviewer is remote. | `Local:` only works on the host machine; `Public:` is the tunneled link reviewers can open. |
| Always default to a keyed public URL for shared sessions. | Keyed-by-default is the safe posture; only drop the key on a trusted network with explicit user consent. |
| Always use `--no-tunnel` (usually with `--open`) for sensitive or private content. | Keeps the page on `127.0.0.1` with no public exposure. |
| When asked to "apply the comments", always EDIT the source HTML files to satisfy them. | Editing the HTML to act on a review comment is the intended workflow (see below). |
| Always run `tunelito --help` if unsure about a flag. | Flags are the source of truth; never invent options. |

### The one subtlety people get wrong

"The source HTML is untouched" refers to **the injection layer only**: Tunelito
never rewrites your `.html` file to insert its comment client — the client is
added to the HTTP response on the fly. This does **not** mean the HTML is
read-only. When a reviewer leaves a comment and you (or the `--agent` worker) act
on it, **editing the HTML is exactly what should happen**. Refusing to edit the
HTML because it "must stay untouched" is wrong and defeats the purpose.

## Choosing the command (intent → invocation)

| User intent | Command |
| --- | --- |
| "Let someone review/leave feedback on a page while we're on a call." | `tunelito ./index.html` → share the `Public:` URL. |
| "Review a whole folder / mini-site." | `tunelito ./site` (one shared inbox beside the folder). |
| "This has sensitive/client data — keep it private." | `tunelito ./page.html --no-tunnel --open` and warn that public links are bearer access. |
| "Auto-apply comments people leave as they leave them." | `--agent claude` or `--agent codex`, gated (see Agent worker). |
| "Open it in my browser too." | add `--open`. |
| "Label who the owner is in the room." | add `--owner "<name>"`. |
| "Just collaborate live, don't save anything." | `--live` (ephemeral; no Markdown, no agent). |

### Examples

```bash
# Remote review of a single page (default keyed public URL):
tunelito ./index.html

# Folder-backed mini-site, opened locally too:
tunelito ./site --owner "Sergio" --open

# Sensitive content — local only, no tunnel:
tunelito ./report.html --no-tunnel --open

# Gated auto-apply with Claude Code, owner-or-mention only:
tunelito ./site --owner "Sergio" --agent claude \
  --agent-policy owner-or-mention --agent-trigger "@agent"

# Ephemeral live session (nothing written to disk):
tunelito ./deck.html --live
```

## Startup output

Tunelito prints `Local:`, `Comments:`, `Access:`, and `Public:` lines. Hand the
remote reviewer the `Public:` URL. Tell them the link itself is the credential —
treat it like a password, don't post it where strangers can see it.

## The comment inbox (Markdown)

Comments persist to `<page-or-folder>.comments.md` beside the source, or to the
`--out` path. A folder target shares **one** inbox beside the folder (e.g.
`site/` → `site.comments.md`).

Each comment is a Markdown section:

```markdown
## <Name> at <UTC time>
> selected quote (omitted for unanchored notes)

The comment body text.

_Context: scope: `page` · page: `/about.html` · path: `<css selector>` · text offset: 142 · id: `c_...`_
```

- **Scope** is `page` (shows only on that page) or `site` (shows on every page).
- Unanchored notes appear as "Page note" / "Site note" with **no** quote.
- `author role: owner` is added to the context line when `--owner` was set.
- `--live` writes **nothing** to disk and cannot restore after a restart.
- If the exact commented text later changes, the comment stays in the
  Markdown/sidebar but its highlight may not reattach. The note is not lost.

## Applying an inbox to the source (the common task 3)

When the user points at `site.comments.md` (or a single page's `.comments.md`)
and says "go apply these":

1. Read the inbox and parse each `##` section: name, optional quote, body, and
   the `_Context:_` line (`scope`, `page`, `path`, `text offset`, `id`).
2. For each actionable comment, **edit the correct source HTML file** to satisfy
   it. Use `page` to find the file and `path` / quote / `text offset` to locate
   the element. Site-scoped comments apply across pages; page-scoped to one page.
3. Do the work in the source HTML. **Do not edit the `*.comments.md` file** — it
   is the record, not the target.
4. Skip non-actionable notes (questions, praise) rather than forcing an edit.

You are editing HTML on purpose here. The "source untouched" rule is about
Tunelito's injection only and does not apply to you acting on review feedback.

## Agent worker (opt-in; `--agent` / `--agent-command`)

This runs a local coding agent that reads the persistent inbox and edits files
to resolve comments. It is **trusted-session local code execution** — treat
every reviewer comment as a command someone could run on the host.

- `--agent claude` → runs `claude -p` with edit permissions for the served folder.
- `--agent codex` → runs `codex exec` in workspace-write mode.
- `--agent custom` with `--agent-command "<cmd>"` → runs your command from the
  served root with the prompt on **stdin**; it receives env vars
  `TUNELITO_AGENT_ROOT`, `TUNELITO_AGENT_COMMENTS`, `TUNELITO_AGENT_STATE`,
  `TUNELITO_OWNER_NAME`.
- Never with `--live` (no persistent inbox). Never without gating for untrusted
  reviewers.

**Gating policy.** Default `--agent-policy all` sends every comment to the
worker. For shared sessions prefer `--agent-policy owner-or-mention` (owner's
comments, plus comments containing the trigger). Policies `mention` and
`owner-or-mention` **require** a non-`"all"` `--agent-trigger`, e.g.
`--agent-trigger "@agent"`. `owner` uses `--owner`.

**Tuning.** `--agent-interval <s>` fallback poll (default 120),
`--agent-max-attempts <n>` (default 2), `--agent-max-passes <n>` (default 3),
`--agent-instructions[-file]` to append guidance, `--agent-prompt[-file]` to
replace the built-in behavior prompt, `--agent-state <path>` for the ledger.

**State and logs.** Ledger at `.tunelito/agent/state.json`; human-readable log at
`.tunelito/agent/log.md`. Both are blocked from being served.

**Required final worker output** is JSON:

```json
{"comments":[{"id":"c_...","status":"resolved","summary":"...",
  "filesChanged":["about.html"],"completedTasks":["..."],"remainingTasks":[]}]}
```

Statuses: `resolved`, `needs_followup`, `no-op`, `ignored`, `blocked`, `stale`,
`partial`, `changed_needs_review`. A `needs_followup` re-queues the same comment
with its completed/remaining tasks until it reaches `resolved`/`blocked`/
`partial` or hits `--agent-max-passes`. Use status honestly: `no-op` for nothing
to do, `blocked` when you cannot proceed, `needs_followup` only when real
remaining tasks exist.

## Limits (set expectations, don't fight them)

- Annotations need real DOM text. **Canvas, video, images, and cross-origin
  iframes are not annotatable** — selected-text comments won't anchor there.
- Strict in-page CSP `<meta>` tags are stripped from the served response so the
  client can run. (The source file is not changed; only the response is.)
- Tunelito is for temporary review rooms, not permanent hosting.

## Staying current

Flags and defaults can change between versions. The CLI is the source of truth:
run `tunelito --help` (or `npx --yes tunelito --help`) and `tunelito --version`
before relying on a flag you are unsure about. Never invent a flag that does not
appear in that output.

