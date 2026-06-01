# Tunelito explainer video

A sub-60-second explainer for Tunelito, authored as HTML and rendered to MP4 with
[HeyGen Hyperframes](https://github.com/heygen-com/hyperframes) (an HTML-to-video
renderer built for agents: it seeks each frame in headless Chrome and encodes with
FFmpeg, so the same input is deterministic).

This is marketing/media source. It is **not** part of the npm package — the
`files` allowlist in the repo root `package.json` does not include `media/`, so
none of this ships to npm.

## Renders

| File | Aspect | Audio | Captions | Use |
| ---- | ------ | ----- | -------- | --- |
| `renders/tunelito-explainer-landscape.mp4` | 1920×1080 | — | — | Clean silent master (READMEs, docs, GIF source) |
| `renders/tunelito-explainer-landscape-narrated.mp4` | 1920×1080 | voiceover (AAC) | yes | Landing page / YouTube |
| `renders/tunelito-explainer-vertical.mp4` | 1080×1920 | voiceover (AAC) | yes | Shorts / Reels / TikTok |

All three are 57s, 30fps, H.264.

## Source

| File | Composition |
| ---- | ----------- |
| `index.html` | Landscape, silent (the visual master timeline) |
| `narrated.html` | `index.html` + per-scene `<audio>` narration + a synced caption overlay |
| `vertical.html` | `narrated.html` reflowed to portrait via a 1080×1920 override layer |

Shared assets:

- `fonts/` — Space Grotesk (display) + JetBrains Mono (code/UI), self-hosted `.woff2`
  so the renderer embeds them deterministically. Regenerate with `npm run fonts`.
- `vendor/gsap.min.js` — GSAP 3.14.2, vendored locally (the sandbox blocks the CDN
  via TLS interception; vendoring also keeps renders reproducible offline).
- `narration/s1.wav … s7.wav` — one voice clip per scene, generated with Hyperframes'
  built-in Kokoro TTS (voice `am_michael`). Per-scene clips keep captions and audio
  trivially in sync without a transcription pass. See "Regenerate narration" below.

### Structure notes

- Single Hyperframes composition per file: a root `data-composition-id="main"` div
  containing seven absolutely-positioned `.scene` layers, crossfaded by one paused
  GSAP timeline.
- Captions are real DOM nodes faded by the timeline (not JS callbacks), so they
  survive the renderer's frame-seeking.
- Narration `<audio>` clips carry explicit `data-duration` so the linter can verify
  the single audio track never overlaps itself.

## Rebuild

Requires Node 22+ and FFmpeg.

```bash
cd media/explainer
npm run fonts            # re-download the woff2 files (only if missing/updating)
npm run check            # hyperframes lint + validate + inspect (index.html)
npm run render:landscape
npm run render:narrated
npm run render:vertical
```

> `npm run check` validates `index.html`. To lint/validate/inspect a variant,
> copy it to `index.html` in a scratch dir (the CLI's non-render commands key off
> `index.html`); `render` itself targets a specific file with `-c`.

### Regenerate narration

```bash
# example: scene 1 line
npx --yes hyperframes@0.6.64 tts "Meet Tunelito. It turns any local HTML file into a live review room." \
  -v am_michael -o narration/s1.wav
```

The Kokoro TTS model downloads on first run and needs the Python package
`kokoro-onnx` (`pip install kokoro-onnx soundfile`). Some scenes use `-s` (speed)
so each clip fits its scene window; see `narrated.html` for the per-scene
`data-start` / `data-duration` values.
