# Anchored comment

An anchored comment lets a reviewer select text on the served page, write a note, and see that note in the comments panel and in the comments Markdown.

## Sub-features

- `anchor-select` shows the `Comment` button after a text selection.
- `anchor-save` stores the quote and the body.
- `anchor-persist` writes both into the comments file without changing the HTML source.

## How to get to it (user POV)

- Open the keyed `Local:` URL for `examples/simple-review.html`.
- Select the sentence that starts `Select this sentence`.
- Choose `Comment`, write the note, and choose `Add comment`.
- Choose `Open Tunelito comments` to read it back.

## Driving it with Playwright

Preconditions:

- `launch examples/simple-review.html` has printed a record.
- `doctor` prints `"ok": true`.
- A status node matching `/^Connected\b/` is attached. It stays hidden until the panel opens.

- **Scripted proof.** Run `node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs drive anchored-comment`. The command triple-clicks the sentence, fills `Selection stays anchored.`, saves, and opens the panel.
- **Visible result.** `evidence/anchored-comment/after.png` shows the body. `panel.aria.txt` includes that body. `comments.md` includes `Selection stays anchored.` and `Select this sentence`.
- **Source unchanged.** `proof.json` reports `sourceUnchanged: true`. The copied HTML hash still matches `examples/simple-review.html`.

## Gotchas

- The `Comment` button is absent until the selection is non-collapsed.
- Saving before the status says `Connected` writes nothing.
- The launcher name becomes `Open Tunelito comments (1)` after the save. Match the prefix.
- The composer and panel live in the open shadow root of `#tunelito-root`.
