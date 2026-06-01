# Tunelito explainer video

A ~56-second explainer for Tunelito, authored as HTML and rendered to MP4 with
[HeyGen Hyperframes](https://github.com/heygen-com/hyperframes) (an HTML-to-video
renderer built for agents: it seeks each frame in headless Chrome and encodes with
FFmpeg, so the same input is deterministic).

This is marketing/media source. It is **not** part of the npm package — the
`files` allowlist in the repo root `package.json` does not include `media/`, so
none of this ships to npm.

## Renders

| File | Aspect | Use |
| ---- | ------ | --- |
| `renders/tunelito-explainer-landscape.mp4` | 1920×1080 | README / docs / landing page |
| `renders/tunelito-explainer-vertical.mp4` | 1080×1920 | Shorts / Reels / TikTok |

Both are silent, 56s, 30fps, H.264.

## Narrative

A calm, factual product walkthrough — no problem-pitch, no narration:

1. **What it is** — a live, shareable preview for the rich HTML your coding agent builds.
2. **Point it at a page** — `npx tunelito ./report.html` serves it over a secure tunnel. No deploy, no API keys, no setup.
3. **Comment together, your agent edits live** *(the hero beat)* — you and a coworker leave comments on the page; a `claude · local agent` card picks them up, and the weak sentence **rewrites in the browser** with a "⟳ Reloaded" flash. Human + agent collaborating in real time.
4. **The loop** — comments land in Markdown; tag `@claude` or let the agent scan on an interval; it edits the page; the preview reloads. Reusing the coding agent you already run locally.
5. **Then move on** — kill the process, the tunnel closes, your file never left your machine, and every comment is saved in Markdown beside it.
6. **Outro** — point it at a page, iterate together, move on.

The scene-3 live edit is two stacked paragraphs (before/after) crossfaded by the
timeline — deterministic and seek-safe, like everything else here.

## Design system — "México Noir" (Joyful Brutalist Minimalism)

The video applies the [soyserg.io](https://soyserg.io) personal brand system
(*"Leave the edges showing, but light them with a smile"*):

- **Palette:** Bone `#FFFEF9` page, Noir `#0A0A0A` ink, Graphite `#2A2A2A` body,
  Desert Sand `#F4F1E8` quiet bands, **Terracotta `#B84C2F`** as the lone accent,
  Sage `#657458` for metadata and the grid, Accent Pop `#FF5E3A` for tiny moments.
- **Notebook grid** painted on the page (20px minor / 100px major sage lines) —
  the signature "scaffolding" motif.
- **Type:** Source Serif 4 (variable) for display + body, **Kalam** for handwritten
  margin notes, JetBrains Mono for the "system monospace" role (terminals, build
  stats, timestamps).
- **Brutalist frames:** 2px solid-noir borders, zero radius, and the one hard
  offset shadow (`10px 10px 0`) on the terminal/report cards. No ambient shadows,
  no gradients except the terracotta **highlighter pill** (the `38%`).
- **The one delight** = marginalia. The live reviewer comments are rendered as
  **Kalam handwritten notes** in the document margin, while the agent's action is
  **monospace in a terracotta box** — handwriting (human) vs. machine (agent).
  Plus the pulsing `→` arrow in the loop and a `más ideas que tiempo` aside.
- **Motion:** snappy (200–450ms), restrained easing, no playful bounces.

## Source

| File | Composition |
| ---- | ----------- |
| `index.html` | Landscape 1920×1080 (the master timeline) |
| `vertical.html` | The same composition reflowed to portrait via a 1080×1920 override layer |

One paused GSAP timeline crossfades six absolutely-positioned `.scene` layers over
the bone + notebook-grid background.

Shared assets:

- `fonts/` — Source Serif 4 (roman + italic, variable), Kalam 300/400/700, and
  JetBrains Mono 400/700, self-hosted `.woff2` so the renderer embeds them
  deterministically. Regenerate with `npm run fonts`.
- `vendor/gsap.min.js` — GSAP 3.14.2, vendored locally (the build sandbox blocks the
  CDN via TLS interception; vendoring also keeps renders reproducible offline).

## Rebuild

Requires Node 22+ and FFmpeg.

```bash
cd media/explainer
npm run fonts            # re-download the woff2 files (only if missing/updating)
npm run check            # hyperframes lint + validate + inspect (index.html)
npm run render:landscape
npm run render:vertical
```

> `npm run check` validates `index.html` (the CLI's non-render commands key off
> `index.html`). `render` targets a specific file with `-c`, which is how the
> portrait cut is produced from `vertical.html`.
