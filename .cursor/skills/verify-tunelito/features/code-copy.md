# Code copy

A Markdown room adds a copy button to each fenced code block, copies the exact code, and still lets a reviewer comment on that code.

## Sub-features

- `copy-button` shows button `Copy <language> code` on hover or keyboard focus. Mermaid figures get none.
- `copy-exact` writes the fenced code to the clipboard with no button label or added text.
- `copy-announce` sets the `status` region to `Copied code to clipboard`.
- `copy-anchor` saves a comment on the selected code block. The quote is the code text only.

## How to get to it (user POV)

- Open the keyed URL for `examples/markdown/kitchen-sink.md`.
- Hover the YAML block under `Fenced code boundaries` and choose the copy button.
- Select the block's text, choose `Comment`, write the note, and choose `Add comment`.

## Driving it with Playwright

Preconditions:

- `cleanup` the previous instance if one is alive.
- `launch examples/markdown/kitchen-sink.md` has printed a record.
- `doctor` prints `"ok": true`.

- **Scripted proof.** Run `node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs drive code-copy`. The command grants clipboard access, clicks `Copy yaml code`, reads the clipboard, selects the whole block, saves `Code block stays anchored.`, and opens the panel.
- **Visible result.** `evidence/code-copy/copied.png` shows the `Copied` label and check icon. `after.png` shows the comment body. `code.aria.txt` lists the code and the button.
- **Saved result.** `comments.md` includes the comment body and the first line of the YAML fence, and does not include `Copy yaml code`. `proof.json` reports `clipboardMatchesFence: true` and `sourceUnchanged: true`.

## Gotchas

- The button is hidden with `opacity: 0` until hover or focus. It is still in the accessibility tree, so role locators find it.
- Clipboard reads need `clipboard-read` permission for the room's origin.
- The drive uses the first fenced block in the fixture. It refuses a fixture whose first fence is `mermaid`.
- Served HTML pages never get the button. `npm run browser:check` covers that path.
