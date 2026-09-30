# Folder review

Folder review serves a directory as a landing page and lets a reviewer open one of its documents without a hand-written index.

## Sub-features

- `folder-land` shows the folder title and region `Folder contents`.
- `folder-open` follows a document link into that file's review room.
- `folder-current` marks that document in the sidebar list `Served documents`.

## How to get to it (user POV)

- Open the keyed URL for `examples/markdown`.
- Choose the `minimal-text.md` card.
- Read the document, then use the sidebar list `Served documents` to see that this file is current.

## Driving it with Playwright

Preconditions:

- `cleanup` the previous instance if one is alive.
- `launch examples/markdown` has printed a record.
- `doctor` prints `"ok": true`.

- **Read the landing.** The heading is `markdown`. Region `Folder contents` is visible. Run `page.getByRole("region", { name: "Folder contents" }).waitFor()`.
- **Open a document.** Run `page.getByRole("link", { name: "minimal-text.md" }).click()`. The article contains `This is the smallest useful Tunelito Markdown review`.
- **Confirm the sidebar.** The nav labelled from `Served documents` shows a link `minimal-text.md` with the current page. `page.getByRole("link", { name: "minimal-text.md" })` resolves, and that link has `aria-current="page"`.
- **Proof.** Save screenshots of the landing and the opened document under `evidence/folder-review/`. The landing screenshot shows the heading `markdown`.

## Gotchas

- The accessible name of a file card includes the kind, such as `Markdown`. Match the filename without `exact: true`.
- `examples/markdown` has no authored `index.md`. The heading `markdown` is the generated landing title, not a document heading.
- The link `Parent folder` is on a nested generated landing, such as a child directory that has no `index.md`. It is absent on this root landing and on the opened document.
- Launching a folder sets `sourceHash` to null. `drive anchored-comment` rejects that instance. Use `examples/simple-review.html` for the anchored comment.
