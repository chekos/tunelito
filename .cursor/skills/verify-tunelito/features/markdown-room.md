# Markdown room

A Markdown room renders a `.md` file as the review page and offers a document map the reviewer can use to move through blocks.

## Sub-features

- `md-render` shows the Markdown paragraph in `main`.
- `md-map` exposes nav `Document map`.
- `md-jump` activates the paragraph tick.

## How to get to it (user POV)

- Open the keyed URL for `examples/markdown/minimal-text.md`.
- Use the document map tick for the only paragraph.

## Driving it with Playwright

Preconditions:

- `cleanup` the previous instance if one is alive.
- `launch examples/markdown/minimal-text.md` has printed a record.
- `doctor` prints `"ok": true`.

- **Confirm the article.** `page.locator("main.tunelito-markdown")` contains `This is the smallest useful Tunelito Markdown review`. The page has no `h1`. That missing heading is the fixture.
- **Confirm the map.** `page.getByRole("navigation", { name: "Document map" })` is visible.
- **Use the tick.** Run `page.getByRole("button", { name: "Go to Paragraph" }).click()`. The paragraph is still the current article text.
- **Confirm injection.** `#tunelito-root` is attached, and the button `/Open Tunelito comments/` is visible.
- **Proof.** Save a screenshot and an accessibility snapshot under `evidence/markdown-room/`. The snapshot includes `Document map` and `Go to Paragraph`.

## Gotchas

- Do not require an `h1` on `minimal-text.md`, `paragraphs-only.md`, or `single-long-paragraph.md`.
- Heading ticks are links named `Go to <heading text>`. This fixture's only tick is a button named `Go to Paragraph`.
- The map is outside the comment surface. Selecting its label must not open an anchored comment on the map itself.
