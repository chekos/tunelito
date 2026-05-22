# Quality Gates

Use the smallest relevant gate while developing, then run `npm run ci` before commit or handoff.

## Always

```bash
npm run check
npm run agent:check
npm test
```

## CLI Changes

Required:

- `test/cli.test.js`
- `node bin/tunelito.js --help`
- `node bin/tunelito.js --version`

Also update:

- `README.md` option table
- `CHANGELOG.md` when behavior changes

## Server or Security Changes

Required:

- `test/server.test.js`
- negative-path tests for malformed input, unauthorized access, and traversal-sensitive paths
- manual smoke with `--no-tunnel`

Smoke pattern:

```bash
node bin/tunelito.js examples/simple-review.html --no-tunnel --port 4317
curl -i http://127.0.0.1:4317/
curl -i 'http://127.0.0.1:4317/?tunelito_key=...'
```

## Client/UI Changes

Required:

- `npm test`
- inspect injected `/__tunelito/client.js`
- run a local page and verify the injected script appears

For mobile or visual changes, use a real browser/device when available.

## Packaging Changes

Required:

```bash
npm run ci
npm pack
npm install -g --prefix /tmp/tunelito-prefix ./tunelito-*.tgz
/tmp/tunelito-prefix/bin/tunelito --version
```

If GitHub installation is part of the expected beta path, verify after pushing:

```bash
npm install -g github:chekos/tunelito
tunelito --version
```

## Agent Process Changes

Required:

```bash
npm run agent:check
npm run ci
```

Also manually inspect:

- `.claude/settings.json`
- `.claude/hooks/*.mjs`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/agents/*.md`

## Release Changes

Required:

- `CHANGELOG.md`
- `docs/RELEASING.md`
- package version consistency across `package.json`, `package-lock.json`, README examples, and release docs
- GitHub Actions green after push
