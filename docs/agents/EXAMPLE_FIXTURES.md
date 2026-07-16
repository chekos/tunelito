# Example Fixtures

Use the example fixtures as the shared regression surface for Tunelito UI work. They are not just demos for public docs; they are repo-local test pages that let agents verify the injected review UI across realistic document shapes.

## Fixture Taxonomy

### HTML fixtures

| Fixture | Use case | What it stresses |
| --- | --- | --- |
| `examples/simple-review.html` | Small smoke test | Normal headings, paragraphs, cards, and markdown persistence |
| `examples/research-paper.html` | Text-dense research or policy paper | Long selections, footnotes, figures, tables, sticky margin notes, restored highlights |
| `examples/slide-deck.html` | Slides shared live on a call | Fixed 16:9 stage, large type, sparse copy, keyboard navigation, page notes |
| `examples/dashboard-spa.html` | App prototype or dashboard SPA | Fixed app chrome, hash routes, dense tables, chart surfaces, status labels, widget comments |
| `examples/project-brief.html` | Day-to-day report or planning brief | Supervisor feedback, agenda items, action tables, decision lists, meeting notes |

### Markdown fixtures

| Fixture | Use case | What it stresses |
| --- | --- | --- |
| `examples/markdown/minimal-text.md` | Smallest valid Markdown review, intentionally no h1 | One paragraph, one semantic block, one ruler tick |
| `examples/markdown/paragraphs-only.md` | Prose-only review, intentionally no h1 | Equal short ticks, consumed/current/unread states, later thematic break versus leading front matter |
| `examples/markdown/single-long-paragraph.md` | One block spanning many viewports, intentionally no h1 | No invented intra-paragraph ticks, exact single target |
| `examples/markdown/heading-ladder.md` | Heading and label diagnostics | h1–h6 hierarchy, skipped levels, repeated labels, stable ids, punctuation, Unicode, hostile-looking text, truncation |
| `examples/markdown/frontmatter-flat.md` | Typical Obsidian note | Ordered scalars, quoted strings, booleans, numbers, dates, tags, aliases, drawer open/collapsed |
| `examples/markdown/frontmatter-nested.md` | Complex property stress | Nested maps, arrays of objects, mixed arrays, nulls, multiline and long values, escaping |
| `examples/markdown/frontmatter-invalid.md` | Broken YAML recovery | Accessible metadata error, escaped source disclosure, readable article |
| `examples/markdown/kitchen-sink.md` | Full Markdown integration | Every top-level ruler block, code boundaries, local image, Mermaid, ordinary links, wiki links, metadata |
| `examples/markdown/ruler-density.md` | Dense document performance | At least 150 meaningful blocks, crowding, measurement, target accuracy, label usability |
| `examples/markdown-vault/index.md` | Folder/index and Obsidian context | Companion notes, aliases, target-plus-heading and unresolved references, code boundaries, literal embeds |

## When To Use Them

For client/UI changes, choose the smallest fixture set that exercises the risk:

| Change area | Check these examples |
| --- | --- |
| Text anchoring or restored highlights | `research-paper.html`, `project-brief.html`, `simple-review.html` |
| Overlay placement, panel behavior, or viewport layout | `slide-deck.html`, `dashboard-spa.html` |
| App chrome, URL state, or SPA route behavior | `dashboard-spa.html` |
| Agent-session or follow-up workflows | `project-brief.html`, `dashboard-spa.html`, `research-paper.html` |
| Docs screenshots or visual regressions | `project-brief.html`, `slide-deck.html`, `dashboard-spa.html` |

For Markdown-specific changes, use this smaller risk-based set:

| Change area | Check these fixtures |
| --- | --- |
| Basic Markdown shell or no-heading behavior | `minimal-text.md`, `paragraphs-only.md`, `single-long-paragraph.md` |
| YAML parsing, drawer layout, escaping, or error recovery | `frontmatter-flat.md`, `frontmatter-nested.md`, `frontmatter-invalid.md`, `kitchen-sink.md` |
| Wiki-link parsing and transform boundaries | `kitchen-sink.md`, `markdown-vault/index.md` |
| Ruler hierarchy, ids, labels, and keyboard navigation | `paragraphs-only.md`, `heading-ladder.md`, `single-long-paragraph.md` |
| Ruler integration with mixed content and Mermaid | `kitchen-sink.md` |
| Ruler density or scroll performance | `ruler-density.md` |
| Folder-mode Markdown behavior | `markdown-vault/` |
| Markdown screenshots | `frontmatter-flat.md`, `frontmatter-nested.md`, `paragraphs-only.md`, `heading-ladder.md`, `single-long-paragraph.md`, `kitchen-sink.md`, `markdown-vault/index.md` |

The ruler treats h5 and h6 as headings rather than dropping them: h5 uses a 14px tick and h6 uses a 12px tick, both slightly longer than the 10px ordinary-content tick. Both levels receive labels, stable ids, hash navigation, and the same keyboard/current-section behavior as h1–h4.

The desktop ruler is a vertically centered dial rather than a full-height rail. Its track is 500px tall when space permits and contracts to `calc(100vh - 120px)` on shorter desktop viewports, leaving 60px above and below. Browser coverage should verify both the capped and contracted geometry before the ruler disappears at the mobile breakpoint.

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

Run the Markdown suite or vault in folder mode:

```bash
node bin/tunelito.js examples/markdown --no-tunnel --port 4317
node bin/tunelito.js examples/markdown-vault --no-tunnel --port 4318
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

The useful-h1 check intentionally does not apply to `minimal-text.md`, `paragraphs-only.md`, or `single-long-paragraph.md`; their missing heading is the regression condition. For ruler work, also run `npm run browser:check` to verify real marker counts/targets, h1–h6 ids and lengths, hover retreat after pointer navigation, keyboard-only focus expansion, reduced motion, horizontal overflow, and axe WCAG 2 A/AA rules.

Automated tests do not replace this pass. They are the package gate; these fixtures are the human-readable UI gate.

## Accessibility Checks

For accessibility-sensitive UI or fixture changes, run automated checks against the changed fixture pages:

```bash
npx --yes pa11y --standard WCAG2AA "file://$PWD/examples/project-brief.html"
npx --yes @axe-core/cli "file://$PWD/examples/project-brief.html"
```

Run the full fixture set when changing shared styles, semantic structure, overlay placement, focus behavior, or docs screenshots.
