# Page note

A page note lets a reviewer leave a comment without selecting text. The panel calls it a page note, and the comments file records that there was no selection.

## Sub-features

- `note-open` opens the `Add comment` dialog from `Page note`.
- `note-save` stores the body with an empty quote.
- `note-persist` writes a page-note line into the comments file.

## How to get to it (user POV)

- Open the keyed URL for `examples/simple-review.html`.
- Choose `Open Tunelito comments`.
- Choose `Page note`, write the note, and choose `Add comment`.

## Driving it with Playwright

Preconditions:

- `launch examples/simple-review.html` has printed a record.
- `doctor` prints `"ok": true`.
- A status node matching `/^Connected\b/` is attached. It stays hidden until the panel opens.
- Use a body that is not `Selection stays anchored.`, so this proof stays distinct from the anchored comment.

- **Open the panel.** Run `page.getByRole("button", { name: /Open Tunelito comments/ }).click()`. The panel named `Tunelito comments` is visible.
- **Open the composer.** Run `page.getByRole("button", { name: "Page note" }).click()`. The dialog `Add comment` is visible and its textbox placeholder is `Leave a page note`.
- **Save the note.** Fill the dialog textbox with `Page note from the panel.` and run `page.getByRole("dialog", { name: "Add comment" }).getByRole("button", { name: "Add comment" }).click()`. The panel shows `Page note from the panel.`
- **Confirm persistence.** Read the run's `comments.md`. It contains `Page note from the panel.` and `Page note (no selected text)`. The copied HTML hash still matches the repo fixture.
- **Proof.** Save a screenshot and `page.getByRole("complementary", { name: "Tunelito comments" }).ariaSnapshot()` under `evidence/page-note/`. A snapshot of `body` omits the open shadow root. The screenshot shows the heading `A simple page for checking shared comments.` and the note body.

## Gotchas

- `Page note` is inside the panel. Open the panel before looking for it.
- A page note has no blockquote in the comments file. The marker is `Page note (no selected text)`.
- `Site note` is the neighboring button. Do not click it for this feature.
