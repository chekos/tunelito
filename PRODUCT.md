# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Tunelito has two surfaces: a Node.js CLI that runs in a terminal (or under a
coding agent), and a review UI injected into the served HTML or Markdown page.

## Users

- **The owner:** a person who made a page, memo, or small site on their own
  machine and wants feedback on it, often live on a call. They start Tunelito
  in a terminal next to their browser and glance at it once to grab the link to
  share.
- **Reviewers:** designers, clients, teammates, or PMs who open the shared link
  in a browser, select text, and leave comments. They never touch the CLI.
- **Coding agents:** Claude Code, Codex, or another local agent that starts the
  review room, reads the comments inbox, and applies edits to the source files.

Every capability is designed for people and agents together: a browser control
or readable terminal output for people, and a CLI flag, config key, or JSON
output for agents.

## Product Purpose

Turn any local HTML or Markdown file, or a folder of them, into a temporary live
review room with one command, and land the feedback as readable Markdown beside
the source so a person or an agent can act on it. Success is a reviewer's
comment reaching the source file with no copy-paste, no upload, and no account.

## Positioning

Local-first review with no hosting step. The files stay on the owner's
machine, the public URL is a temporary keyed Cloudflare Quick Tunnel back to it,
and comments are plain Markdown that agents can parse and close the loop on.

## Operating Context

- Started from a terminal or by a coding agent in a PTY or background process.
- Shared on video calls; the owner keeps the terminal open while reviewers
  comment.
- The owner keeps editing the source in their editor; browsers hot-reload.
- Agents work through the comments inbox (`inbox`, `comments inspect`, MCP).
  Startup state is in `.tunelito/session.json` and the `--json` event stream.

## Capabilities and Constraints

- The source HTML or Markdown is never modified by the annotation layer. The
  only exception is an explicit `--editable` save from the direct local owner.
- Comments persist to `<page-or-folder>.comments.md` (or `--comments <path>`)
  unless `--ephemeral` is set.
- Public tunnel sessions require keyed URLs by default. The direct loopback
  `Local` URL is the owner; tunnel and forwarded sessions are visitors.
- Node.js 22+, no runtime dependencies.
- CLI output: human-readable on a TTY with semantic color only. `--json` gives
  scripts and agents a structured stream. Errors print one line plus a fix;
  usage errors exit 2, runtime errors exit 1.

## Brand Commitments

- Name: Tunelito (lowercase `tunelito` in the terminal).
- Voice: plain, direct, and short. Labels name things (`Local`, `Public`,
  `Comments`), hints say what to do (`share this`), and errors name the problem
  and the fix.

## Evidence on Hand

- `examples/`: HTML and Markdown review fixtures (see
  `docs/agents/EXAMPLE_FIXTURES.md`).
- `docs-site/`: the Mintlify documentation, including the CLI reference and
  the distributable agent skill (`docs-site/skill.md`).
- No customer testimonials, usage metrics, or case studies are on hand; do not
  invent them.

## Product Principles

1. **One link, one glance.** The thing to share is the focal point of every
   startup; everything else is secondary or behind `--verbose`.
2. **People and agents, always both.** Every feature ships a human control and
   an agent surface together.
3. **The source is the owner's.** Review never mutates it implicitly.
4. **Safe by default.** Keyed links, loopback-only owner powers, and secrets
   read only from the environment and never echoed.
5. **Readable artifacts.** Comments, status, and errors are text a person can
   read and an agent can parse.
