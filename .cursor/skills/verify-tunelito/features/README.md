# Tunelito verification map

This directory is the maintained source for verifying Tunelito's browser review room. Read the index, then use the matching feature file.

## Baseline preconditions

- Run commands from the repo root after `npm install`.
- Launch with `node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs launch <fixture>`.
- The helper copies the fixture and passes `--no-tunnel --port 0 --out <run>/comments.md`.
- Run `doctor` and require `"ok": true` before driving.
- Never drive an instance this run did not start. One checkout, one live instance.

## Driving conventions

- Start from the feature file's fixture unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names. Playwright role locators pierce `#tunelito-root`'s open shadow root.
- Treat commands as literal.
- Capture the action and the resulting state. Read the comments file for anything a click claims to save.
- Compare the copied fixture bytes with the repo file after a comment. The source must stay unchanged.
- Leave `evidence/` in place during cleanup.

## Proof and skip reporting

- UI proof includes an accessibility snapshot and a screenshot that shows the page heading or folder title.
- Mutation proof includes the comments Markdown, not only the panel.
- Record the feature id and the fixture with every artifact.
- Report an unreachable path with the command you ran and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph. It then uses these H2 sections in order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright`
4. `Gotchas`

## Features

- [Anchored comment](./anchored-comment.md) saves a comment on selected text and writes the quote plus body to the comments file.
- [Page note](./page-note.md) saves an unanchored page note from the comments panel.
- [Markdown room](./markdown-room.md) opens a Markdown fixture and moves with the document map.
- [Folder review](./folder-review.md) opens a folder landing and follows a document link.
