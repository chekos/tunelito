---
name: verify-tunelito
description: Drive a local Tunelito review room in a browser and prove comments, Markdown rooms, and folder navigation against a copied fixture. Use when changing injected review UI, comment persistence, Markdown rendering, or folder serving, or when asked to verify Tunelito in a browser.
---

# Verify Tunelito

Tunelito's user-facing surface is the browser review room served by the CLI. A second surface is the terminal (`doctor`, `inbox`). This skill drives the browser room. It does not open a public tunnel.

One checkout owns one verification instance. The helper refuses to launch while that instance is alive. Run `cleanup` first.

Read [features/README.md](features/README.md) before driving. Follow the matching feature file. A proof that uses one entry point does not cover the others.

## Launch

From the repo root, with dependencies already installed (`npm install`):

```bash
node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs launch examples/simple-review.html
```

The helper copies the fixture into `.cursor/skills/verify-tunelito/runs/<id>/workspace/`, starts `node bin/tunelito.js <copy> --no-tunnel --port 0 --out <run>/comments.md`, and waits until stdout contains `Local:`. Ready means `doctor` prints `"ok": true`.

Pass another repo-relative fixture when the feature file names one, such as `examples/markdown/minimal-text.md` or `examples/markdown`.

Do not add `--open`. Do not serve `examples/` in place. That writes `*.comments.md` beside the fixture.

## Doctor

```bash
node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs doctor
```

Run this before driving, and again when a page looks wrong. Exit 0 means the recorded pid is alive, `lsof` shows that pid listening on the recorded port, the keyed page returns 200 with `/__tunelito/client.js`, and `/__tunelito/comments.md` starts with `# Tunelito comments`.

`tunelito doctor` is a different check. It treats a listening port as a failure because it is looking for a free port. Do not use it as the gate for an instance this skill already started.

## Drive

Playwright is the harness. It is already a devDependency. If `drive` reports that the browser executable is missing, run `npx playwright install chromium` once from the repo root, then drive again. Role locators pierce the open shadow root on `#tunelito-root`.

Stable handles:

- `#tunelito-root` is the injected host.
- Button `Open Tunelito comments` opens the panel. After the first comment the name gains a count, so match `/Open Tunelito comments/`.
- Button `Comment` appears only after a non-collapsed text selection.
- Dialog `Add comment` holds the comment textbox and the button `Add comment`.
- Buttons `Page note` and `Site note` sit in the group `Add unanchored comment`.
- Nav `Document map` is on Markdown pages. A paragraph tick is the button `Go to Paragraph`.
- Folder landings expose region `Folder contents`. Each file is a link whose name includes the filename, such as `minimal-text.md`.

The scripted path for the anchored comment is:

```bash
node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs drive anchored-comment
```

That command is valid only after launching `examples/simple-review.html`. Other features use the same Playwright handles. Their steps are in `features/`.

`show` prints the live record, including the keyed `localUrl`. Use that URL. A request without `tunelito_key` is rejected.

```bash
node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs show
```

Wait until a node matches `/^Connected\b/` before saving a comment. That node sits inside the closed panel, so wait for `attached`, not `visible`. Saving earlier leaves the status `Still connecting; try again in a moment.` and writes nothing.

## Evidence

Write proof under `.cursor/skills/verify-tunelito/evidence/<feature>/`. The anchored-comment drive already writes:

- `before.png` after load, before the selection
- `composer.png` with the dialog open and the body filled
- `after.png` with the panel open and the body visible
- `panel.aria.txt` from the `Tunelito comments` complementary snapshot, with `tunelito_key` redacted. A `body` snapshot omits the open shadow root.
- `comments.md` copied from the run inbox
- `proof.json` with the fixture, origin, body, quote, and source-hash result

A proof shows the action and the result. The comments file must contain the body. An anchored comment must also contain the selected quote. The copied HTML or Markdown bytes must still match the repo fixture. `proof.json` stores the origin only. Leave the access key in `runs/current.json`, which cleanup deletes.

`evidence/` and `runs/` are gitignored. Do not commit them.

## Cleanup

```bash
node .cursor/skills/verify-tunelito/scripts/verify-tunelito.mjs cleanup
```

Cleanup sends `SIGTERM` to the pid in `runs/current.json`, then `SIGKILL` if it is still alive after 1.5 seconds. It deletes that run directory and `current.json`. It does not delete `evidence/`. A second cleanup with no record prints `no instance` and exits 0.

Kill only that pid. Do not kill by process name.

## Helpers

[scripts/verify-tunelito.mjs](scripts/verify-tunelito.mjs) is the only helper. Invoke it with `node` from the repo root, as the sections above show.

When this map drifts from the app, run `/maintain-verification-skill`.
