# Release Playbook

Use this for package verification and npm releases. See `docs/RELEASING.md` for the public release process.

## Release Readiness

Before declaring a release shareable:

```bash
npm run release:check -- 0.1.2
npm run ci
npm run pack:check
```

Then smoke a page:

```bash
/tmp/tunelito-prefix/bin/tunelito examples/simple-review.html --no-tunnel --port 4317
```

Verify:

- unkeyed `/` returns `401`
- keyed `/` returns the example page
- keyed `/__tunelito/client.js` contains WebSocket setup and WebRTC live-mode support

The lightweight automated local smoke is:

```bash
npm run smoke:check
```

It starts the CLI against `examples/simple-review.html`, loads the keyed page, verifies the injected client route and root mount marker are present, and checks the comments markdown endpoint. Full browser text-selection automation remains a later Playwright-sized follow-up.

## Version Changes

Keep these in sync:

- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `docs/RELEASING.md`

Version changes must go through a PR before release. Stable versions publish to npm `latest`; prerelease versions publish to the prerelease channel named by the first semver identifier, such as `rc` for `0.1.2-rc.0`.

Run `npm run release:check -- <version-or-tag>` after version files are updated. The check verifies `package.json`, `package-lock.json`, `CHANGELOG.md`, the derived npm dist-tag, and whether that exact version is already published. Pass `--allow-published` only when intentionally auditing an already-published version.

## npm Install Smoke

After publishing:

```bash
npx --yes tunelito --version
npm install -g tunelito@0.1.2
tunelito --version
```

Use the exact released version for the global install command. This keeps the maintainer's local `tunelito` binary current after every release. If either install path fails, fix it before telling the user the release is ready.

## npm Publishing

Use trusted publishing through GitHub Actions. Do not introduce long-lived npm tokens unless there is a documented reason.

Publishing is triggered by publishing a GitHub Release, not by pushing a tag manually. Draft releases can be created with:

```bash
gh workflow run "Draft Release" -f version=0.1.2
gh workflow run "Draft Release" -f version=0.1.2-rc.0
```

Use npm 11.15 or newer when managing trusted publishers so the required allowed actions are sent:

```bash
npx --yes npm@11.15.0 trust list tunelito
```
