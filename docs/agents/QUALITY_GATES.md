# Quality Gates

Use the smallest relevant gate while developing, then run `npm run ci` before commit or handoff.

## Always

```bash
npm run check
npm run agent:check
npm test
npm run smoke:check
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
npm run release:check -- <version-or-tag>
npm run ci
npm run pack:check
```

After publishing to npm, verify the public install path:

```bash
npx --yes tunelito --version
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

## Mintlify Docs Changes

Required:

```bash
npm run docs:check
npm run ci
```

When working on public docs content, preview with:

```bash
npm run docs:dev
```

For a stricter Mintlify CLI pass, run:

```bash
npm run docs:validate
```

Mintlify CLI validation may require an LTS Node runtime such as Node 22 or 24 even when Tunelito itself supports newer Node releases. If the CLI rejects the local Node version, switch runtimes for this pass and keep `npm run docs:check` as the always-on local and CI gate.

## Release Changes

Required:

- `CHANGELOG.md`
- `docs/RELEASING.md`
- package version consistency across `package.json`, `package-lock.json`, README examples, and release docs
- `npm run release:check -- <version-or-tag>`
- GitHub Actions green after push
