# Example Fixtures

Use the example fixtures as the shared regression surface for Tunelito UI work. They are not just demos for public docs; they are repo-local test pages that let agents verify the injected review UI across realistic document shapes.

## Fixture Taxonomy

| Fixture | Use case | What it stresses |
| --- | --- | --- |
| `examples/simple-review.html` | Small smoke test | Normal headings, paragraphs, cards, and markdown persistence |
| `examples/research-paper.html` | Text-dense research or policy paper | Long selections, footnotes, figures, tables, sticky margin notes, restored highlights |
| `examples/slide-deck.html` | Slides shared live on a call | Fixed 16:9 stage, large type, sparse copy, keyboard navigation, page notes |
| `examples/dashboard-spa.html` | App prototype or dashboard SPA | Fixed app chrome, hash routes, dense tables, chart surfaces, status labels, widget comments |
| `examples/project-brief.html` | Day-to-day report or planning brief | Supervisor feedback, agenda items, action tables, decision lists, meeting notes |

## When To Use Them

For client/UI changes, choose the smallest fixture set that exercises the risk:

| Change area | Check these examples |
| --- | --- |
| Text anchoring or restored highlights | `research-paper.html`, `project-brief.html`, `simple-review.html` |
| Overlay placement, panel behavior, or viewport layout | `slide-deck.html`, `dashboard-spa.html` |
| App chrome, URL state, or SPA route behavior | `dashboard-spa.html` |
| Agent-session or follow-up workflows | `project-brief.html`, `dashboard-spa.html`, `research-paper.html` |
| Docs screenshots or visual regressions | `project-brief.html`, `slide-deck.html`, `dashboard-spa.html` |

If a new injected-UI feature can affect all page shapes, run the full set. If you skip a relevant fixture, say why in the handoff.

## How To Run

Run one page:

```bash
node bin/tunelito.js examples/project-brief.html --no-tunnel --port 4317
```

Run the whole examples directory when checking navigation between fixtures:

```bash
node bin/tunelito.js examples --no-tunnel --port 4317
```

Use the keyed `Local:` URL printed by the CLI. Do not commit generated `*.comments.md`, session files, screenshots, or tunnel artifacts unless the user explicitly asks for them.

## Browser Checks

For UI changes, verify the relevant fixtures in a real browser when available:

- the Tunelito client is injected and visible
- the page still has a single useful `h1` and `main` landmark
- there is no unexpected horizontal overflow at desktop and mobile widths
- controls remain reachable as native buttons or links
- visible focus styles exist for fixture-owned controls
- SPA routes and slide controls still change state
- text selection and page notes work on the changed surfaces

Automated tests do not replace this pass. They are the package gate; these fixtures are the human-readable UI gate.

## Accessibility Checks

For accessibility-sensitive UI or fixture changes, run automated checks against the changed fixture pages:

```bash
npx --yes pa11y --standard WCAG2AA "file://$PWD/examples/project-brief.html"
npx --yes @axe-core/cli "file://$PWD/examples/project-brief.html"
```

Run the full fixture set when changing shared styles, semantic structure, overlay placement, focus behavior, or docs screenshots.
