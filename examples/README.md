# Tunelito Examples

Tunelito's examples are small HTML fixtures. Use them for demos, screenshots, and regression checks when the injected review UI changes. Each fixture has a distinct visual system so screenshots do not all collapse into the same generic interface style.

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
