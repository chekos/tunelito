# Tunelito Examples

Tunelito's examples are durable HTML and Markdown fixtures. Use them for demos, screenshots, accessibility checks, and browser regression work. Each fixture answers a diagnostic question; do not replace the edge cases with interchangeable demo copy.

## Fixture Taxonomy

| Fixture | Use case | What it stresses |
| --- | --- | --- |
| `simple-review.html` | Small smoke test | Normal headings, paragraphs, cards, and markdown persistence |
| `research-paper.html` | Text-dense research or policy paper | Vellum-style dark scholarly page, long selections, footnotes, figures, tables, and sticky margin notes |
| `slide-deck.html` | Slides shared live on a call | Fixed 16:9 presentation stage, bold printed-catalogue aesthetic, keyboard navigation, and page notes |
| `dashboard-spa.html` | App prototype or dashboard SPA | Cobalt graph-paper dashboard, fixed app chrome, route changes, tables, charts, status labels, and dense widgets |
| `project-brief.html` | Day-to-day report or planning brief | Pinned-paper field notebook, supervisor feedback, action tables, agendas, decision lists, and meeting notes |

## `simple-review.html`

A small styled HTML page with normal DOM text and no custom review JavaScript. Use this for smoke tests:

```bash
tunelito examples/simple-review.html --no-tunnel --open
```

## `research-paper.html`

A long single-page paper with a dark scholarly "vellum" visual system, dense prose, a figure, a table, footnotes, and a sticky margin review guide. Use this when a Tunelito change might affect anchoring, restored highlights, sidebar behavior, or text-dense pages.

```bash
tunelito examples/research-paper.html --no-tunnel --open
```

## `slide-deck.html`

A fixed-stage 16:9 slide deck with a bold printed-catalogue visual system and keyboard navigation. Use this for call-based reviews, large type, sparse text, and page-level feedback.

```bash
tunelito examples/slide-deck.html --no-tunnel --open
```

## `dashboard-spa.html`

A static hash-route dashboard that behaves like a tiny SPA without a build step. It uses a cobalt graph-paper editorial system instead of generic SaaS cards. Use this for app chrome, route state, dense tables, chart surfaces, and comments inside dashboard widgets.

```bash
tunelito examples/dashboard-spa.html --no-tunnel --open
```

Try route changes while reviewing:

```text
http://127.0.0.1:4317/#pipeline
http://127.0.0.1:4317/#risks
```

## `project-brief.html`

A practical single-page planning brief for a supervisor or team review call, styled as a pinned field notebook. Use this for day-to-day reports, meeting agendas, action tables, decision lists, and comments that become follow-up tasks.

```bash
tunelito examples/project-brief.html --no-tunnel --open
```

## Suggested Regression Sets

- For text anchoring or highlight restoration: `research-paper.html`, `project-brief.html`, `simple-review.html`
- For overlay placement or viewport behavior: `slide-deck.html`, `dashboard-spa.html`
- For comments that become local-agent work: `project-brief.html`, `dashboard-spa.html`, `research-paper.html`
- For docs screenshots: start with `project-brief.html`, then use `slide-deck.html` and `dashboard-spa.html` for contrast

## Markdown Fixture Taxonomy

Run a single Markdown fixture with the normal local server shape:

```bash
tunelito examples/markdown/frontmatter-flat.md --no-tunnel --open
```

Run the tiny vault in folder/index mode:

```bash
tunelito examples/markdown-vault --no-tunnel --open
```

| Fixture | Diagnostic question | Run command |
| --- | --- | --- |
| `markdown/minimal-text.md` | Does the smallest heading-free document produce one real paragraph tick? | `tunelito examples/markdown/minimal-text.md --no-tunnel --open` |
| `markdown/paragraphs-only.md` | Do equal paragraph ticks, consumption states, and a later thematic break behave without false front matter? | `tunelito examples/markdown/paragraphs-only.md --no-tunnel --open` |
| `markdown/single-long-paragraph.md` | Does one paragraph spanning many viewports remain exactly one ruler item? | `tunelito examples/markdown/single-long-paragraph.md --no-tunnel --open` |
| `markdown/heading-ladder.md` | Are h1–h6 lengths, labels, stable ids, collisions, Unicode, punctuation, and truncation explicit? | `tunelito examples/markdown/heading-ladder.md --no-tunnel --open` |
| `markdown/frontmatter-flat.md` | Do typical Obsidian scalars, dates, arrays, tags, and aliases render once in the drawer? | `tunelito examples/markdown/frontmatter-flat.md --no-tunnel --open` |
| `markdown/frontmatter-nested.md` | Do nested maps, mixed arrays, nulls, multiline strings, long values, and hostile-looking text remain readable and escaped? | `tunelito examples/markdown/frontmatter-nested.md --no-tunnel --open` |
| `markdown/frontmatter-invalid.md` | Does invalid YAML expose an accessible, escaped source fallback while preserving the article? | `tunelito examples/markdown/frontmatter-invalid.md --no-tunnel --open` |
| `markdown/html-comments.md` | Do inline, block, multiline, and adjacent author comments stay hidden while fenced literals remain visible? | `tunelito examples/markdown/html-comments.md --no-tunnel --open` |
| `markdown/kitchen-sink.md` | Do all ruler block types, transform boundaries, a local image, Mermaid, wiki links, and metadata coexist? | `tunelito examples/markdown/kitchen-sink.md --no-tunnel --open` |
| `markdown/ruler-density.md` | Do at least 150 real blocks remain accurate and usable without per-scroll layout work? | `tunelito examples/markdown/ruler-density.md --no-tunnel --open` |
| `markdown-vault/index.md` | Do folder mode, plain/aliased/fragment/unresolved wiki references, code boundaries, and literal embeds behave together? | `tunelito examples/markdown-vault --no-tunnel --open` |

`minimal-text.md`, `paragraphs-only.md`, and `single-long-paragraph.md` intentionally have no h1. They are structural diagnostics, so the normal useful-h1 expectation does not apply. Serving these fixtures must not create committed comments, session files, screenshots, tunnel artifacts, or source edits.
