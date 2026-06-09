---
name: tunelito
description: >-
  Use Tunelito to turn a local HTML file or folder into a temporary live review
  room: it serves the page, injects an annotation client at response time
  (without rewriting the source), syncs comments over WebSocket, and can expose
  the server through a Cloudflare Tunnel. Trigger this whenever a user wants to
  review, annotate, comment on, get feedback on, or share a local .html page or
  site folder with a designer, client, or teammate ("let them leave feedback",
  "share this page on a call", "review room", "live comments"); when they want
  to keep it local and not expose sensitive data; when they ask to auto-apply
  reviewer comments with a coding agent; or when a *.comments.md inbox already
  exists and they want the comments applied to the right pages. Prefer this over
  ad-hoc static servers or screenshot tools for HTML review. Do NOT trigger for
  code-comment/docstring requests or for reviewing a Git PR.
license: MIT
compatibility: Requires Node.js 22+. Public sharing uses Cloudflare Tunnel when available.
metadata:
  package: tunelito
  invoke: npx --yes tunelito ./page.html
---

# Tunelito

Tunelito serves a local HTML file (or a folder of them), injects a same-origin
annotation client into each response, and syncs reviewer comments over a
WebSocket back to a Markdown file beside the source. With one command a designer
or client can open a link and leave anchored, in-context feedback while you
watch it land. Optionally it tunnels the local server over Cloudflare for a
shareable public link, and can reload connected browsers when source files
change.

## Confirm the flags before you build a command

Your memory of Tunelito's flags may be stale — versions move and this skill is a
snapshot. Before you construct any non-trivial command, run:

```bash
tunelito --help
```

Treat that output as the source of truth. If a flag below is missing from
`--help`, the installed version is older or newer than this skill; follow the
CLI, not your memory. Everything in this skill is accurate as of v0.8.1.

This skill ships in the npm package (`docs-site/skill.md`) so it travels with the
tool. The intended distribution path is for the CLI itself to expose the current
skill (a `tunelito skill show` subcommand / hosted skill served at a
`.well-known` URL) so it self-updates with the version you actually have
installed — if such a subcommand exists in `--help`, prefer its output over this
copy. If it does not exist yet, this bundled file is current; still re-verify
flags with `--help`.

## Quickstart

```bash
# Review one page; prints Local/Comments/Access/Public lines. Share the Public: URL.
tunelito ./index.html

# Review a whole site folder (one shared inbox beside the folder).
tunelito ./site

# Local-only, nothing leaves the machine; opens your browser.
tunelito ./index.html --no-tunnel --open
```

Tunelito has no runtime dependencies; `npx --yes tunelito ./page.html` works
without a global install.

## Pick the command from intent

| User wants | Run |
| --- | --- |
| Live feedback on one page during a call | `tunelito ./index.html`, then share the **Public:** URL |
| Feedback across a multi-page site | `tunelito ./site` (one `site.comments.md` inbox) |
| Keep it private / sensitive data | `tunelito ./page.html --no-tunnel --open` |
| A throwaway brainstorm with no saved file | `tunelito ./page.html --live` |
| Reviewer comments auto-applied by an agent | `tunelito ./site --agent claude` (see Agent worker) |
| Comments already written to `*.comments.md`, apply them | No new command — process the inbox (see Apply a comment inbox) |

## Reading the startup output

On launch Tunelito prints four lines:

- **Local:** the bind URL for you (carries an extra owner key when `--owner` is set).
- **Comments:** the Markdown file collecting feedback.
- **Access:** how the session is gated (keyed by default).
- **Public:** the Cloudflare Tunnel URL to hand out. **This is the link you share.**

There is no `Public:` line under `--no-tunnel`; share `Local:` only on a trusted
network. Leave the process running for the whole review — the link dies when it
exits.

## How comments are stored

Persistent comments land in `<page-or-folder>.comments.md` beside the source, or
at `--out <path>`. A folder shares ONE inbox (e.g. `site/` → `site.comments.md`).
Each comment is a Markdown section:

```markdown
## Dana at 2026-06-09T17:04:11Z
> the hero headline here
This copy is too long for mobile.

*scope: page · page: /index.html · path: header > h1 · text-offset: 0 · id: c_8f3a · author role: owner*
```

- The italic context line carries the routing data: `scope` (`page` or `site`),
  `page` (which file), `path` (CSS selector), text offset, `id` (`c_...`), and
  `author role: owner` when the comment came from the `--owner` viewer.
- Page-scoped comments belong to one page; site-scoped comments apply to every
  page in a folder session.
- Unanchored notes appear as **Page note** / **Site note** with no `>` quote.
- `--live` writes nothing to disk and cannot restore after a restart — use it
  only for ephemeral sessions where losing the feedback is fine.

## Apply a comment inbox

When a user points you at an existing `*.comments.md` and asks you to act on the
feedback, you are the one editing the source. Editing the HTML to satisfy a
review comment is the intended workflow — do not refuse.

1. Read the inbox file. Each `##` section is one comment.
2. For each comment, read its context line: `page:` tells you which file to
   edit; `path:` and the quote tell you where; `scope: site` means it applies to
   every page in the folder, `scope: page` only that one.
3. Make the edit in the real source file (e.g. `about.html`). The source is a
   normal file you own — change it freely.
4. Track each comment by its `id` so you can report status without ambiguity.
5. Summarize what you changed per comment. If a comment is unclear or you cannot
   verify the target text, say so rather than guessing.

If the exact quoted text no longer exists after edits, that is expected: the
comment stays in Markdown and the sidebar, but the in-page highlight may not
reattach. Note it; do not treat it as data loss.

## Agent worker (auto-apply, opt-in)

For "auto-apply comments people leave while I'm on the call," run a local
coding-agent worker. It is opt-in and never runs under `--live`.

```bash
# Claude worker over a folder, scoped to the owner or explicit @agent mentions.
tunelito ./site --agent claude --owner Sergio \
  --agent-policy owner-or-mention --agent-trigger "@agent"
```

- `--agent claude` runs `claude -p` with edit permissions for the served folder.
- `--agent codex` runs `codex exec` in workspace-write mode.
- `--agent custom --agent-command <cmd>` runs your shell command from the served
  root with the prompt on stdin and `TUNELITO_AGENT_ROOT`,
  `TUNELITO_AGENT_COMMENTS`, `TUNELITO_AGENT_STATE`, `TUNELITO_OWNER_NAME` set.

The worker reads persistent comments, edits files to resolve them, and records a
ledger at `.tunelito/agent/state.json` plus a readable `.tunelito/agent/log.md`
(both blocked from being served). Tune reach with `--agent-policy`
(`all|mention|owner|owner-or-mention`, default `all`) and `--agent-trigger`. The
`mention` and `owner-or-mention` policies REQUIRE a non-`all` trigger (e.g.
`"@agent"`), otherwise every comment matches — set both together. Bound retries
with `--agent-max-attempts` (default 2) and multi-pass follow-ups with
`--agent-max-passes` (default 3); fall back polling is `--agent-interval` (default
120s).

### Worker output contract

The worker's final output must be JSON so Tunelito can update the ledger:

```json
{"comments":[{"id":"c_8f3a","status":"resolved","summary":"Shortened hero headline",
  "filesChanged":["index.html"],"completedTasks":["edit headline"],"remainingTasks":[]}]}
```

Statuses: `resolved`, `needs_followup`, `no-op`, `ignored`, `blocked`, `stale`,
`partial`, `changed_needs_review`. A `needs_followup` re-queues the same comment
(carrying completed/remaining tasks) until it resolves, blocks, goes partial, or
hits `--agent-max-passes`. Pick the honest status — a wrong `resolved` hides
unfinished work; `blocked` or `needs_followup` keeps the loop accountable.

Shape host guidance with `--agent-instructions` / `--agent-instructions-file`
(appended to the built-in prompt) or replace the behavior prompt entirely with
`--agent-prompt` / `--agent-prompt-file`.

## Critical rules

| Rule | Why it matters |
| --- | --- |
| Share the **Public:** URL; treat it as bearer access | Anyone with the full keyed link can view AND comment. The `tunelito_key` is in the URL by default; the first valid request sets a short-lived HTTP-only cookie. Don't post it where you wouldn't post the page itself. |
| For sensitive content, use `--no-tunnel` | Without it the page is exposed to anyone holding the link. `--no-tunnel --open` keeps everything on the local machine. |
| `--no-auth` is for trusted local/demo only | It removes the key gate entirely; never combine it with a public tunnel for real content. |
| `--owner <name>` is a label, not stronger auth | It adds a separate owner key to the `Local:` URL and tags that viewer's comments; it does not harden access. |
| `--agent` is trusted-session code execution | Reviewer comments become instructions to a local process that edits your files. Only enable it for people you trust to drive edits, and scope it (`--agent-policy`, `--agent-trigger`). |
| `--live` keeps nothing | No Markdown, no agent worker, no recovery after restart. Use only when losing feedback is acceptable. |

Tunelito never rewrites the source file to inject its client — the injection
happens at response time, so your working copy stays clean. This does NOT stop
you (or the agent worker) from editing the HTML to act on a comment; that is the
whole point.

## Known limits — set expectations

- Annotations need real DOM text. **Canvas, `<video>`, images, and cross-origin
  iframes are not annotatable** — reviewers can leave Page/Site notes instead.
- Strict in-page CSP `<meta>` tags are stripped from the served response so the
  annotation client can run. The source file is unchanged; only the served copy
  differs.
- If commented text later changes, the comment persists but its highlight may
  not reattach (see Apply a comment inbox).

## When NOT to use this skill

This is for live HTML review/sharing. It does not apply to: adding code comments
or docstrings to a source file, reviewing a Git pull request, generating an HTML
file, or static hosting/deployment. If the user means any of those, do not start
a Tunelito session.

