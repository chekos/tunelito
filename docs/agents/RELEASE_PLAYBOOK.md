# Release Playbook

Use this for beta packaging and future npm releases. See `docs/RELEASING.md` for the public release process.

## Beta Readiness

Before declaring a beta shareable:

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

## GitHub Install Smoke

After pushing a beta commit to `main`:

```bash
rm -rf /tmp/tunelito-github-prefix
mkdir -p /tmp/tunelito-github-prefix
npm install -g --prefix /tmp/tunelito-github-prefix github:chekos/tunelito
/tmp/tunelito-github-prefix/bin/tunelito --version
```

If this fails, fix it before telling the user the beta is ready.

## npm Publishing

Use trusted publishing through GitHub Actions. Do not introduce long-lived npm tokens unless there is a documented reason.
