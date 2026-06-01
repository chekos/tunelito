# Tunelito explainer video

A ~53-second explainer for Tunelito, authored as HTML and rendered to MP4 with
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

Both are silent, 53s, 30fps, H.264.

## Narrative

A calm, factual product walkthrough — no problem-pitch, no narration:

1. **What it is** — a live, shareable preview for the rich HTML your coding agent builds.
2. **Point it at a page** — `npx tunelito ./report.html` serves it over a secure tunnel. No deploy, no API keys, no setup.
3. **Share the link, jump on a call** — you and a coworker leave comments right on the page, live.
4. **Your local agent iterates** — comments land in Markdown; the coding agent you already run locally reads them and edits the page; the preview reloads.
5. **Then move on** — kill the process, the tunnel closes, your file never left your machine, and every comment is saved in Markdown beside it.
6. **Outro** — point it at a page, iterate together, move on.

## Source

| File | Composition |
| ---- | ----------- |
| `index.html` | Landscape 1920×1080 (the master timeline) |
| `vertical.html` | The same composition reflowed to portrait via a 1080×1920 override layer |

One paused GSAP timeline crossfades six absolutely-positioned `.scene` layers.

Shared assets:

- `fonts/` — Space Grotesk (display) + JetBrains Mono (code/UI), self-hosted `.woff2`
  so the renderer embeds them deterministically. Regenerate with `npm run fonts`.
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
