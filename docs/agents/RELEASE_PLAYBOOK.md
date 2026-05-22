# Release Playbook

Use this for package verification and npm releases. See `docs/RELEASING.md` for the public release process.

## Release Readiness

Before declaring a release shareable:

```bash
npm run ci
rm -rf /tmp/tunelito-pack /tmp/tunelito-prefix
mkdir -p /tmp/tunelito-pack /tmp/tunelito-prefix
npm pack --pack-destination /tmp/tunelito-pack
npm install -g --prefix /tmp/tunelito-prefix /tmp/tunelito-pack/tunelito-*.tgz
/tmp/tunelito-prefix/bin/tunelito --version
```

Then smoke a page:

```bash
/tmp/tunelito-prefix/bin/tunelito examples/simple-review.html --no-tunnel --port 4317
```

Verify:

- unkeyed `/` returns `401`
- keyed `/` returns the example page
- keyed `/__tunelito/client.js` contains WebSocket setup

## Version Changes

Keep these in sync:

- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `docs/RELEASING.md`

Version changes must go through a PR before release. Stable versions publish to npm `latest`; prerelease versions publish to the prerelease channel named by the first semver identifier, such as `rc` for `0.1.2-rc.0`.

## npm Install Smoke

After publishing:

```bash
npx --yes tunelito --version
```

If this fails, fix it before telling the user the release is ready.

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
