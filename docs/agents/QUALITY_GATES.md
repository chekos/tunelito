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

## Comments Index or Agent Inbox Changes

Required:

- `test/comments.test.js`
- `test/cli.test.js`
- `tunelito comments inspect <target> --json` for a representative target or fixture comments file
- spoofing or damaged-metadata coverage when parsing/restoration behavior changes

Also update:

- `docs/spec/tunelito-comments.md`
- `docs/spec/tunelito-comments.schema.json`
- README and docs-site comments or CLI pages

## Doctor or Diagnostic Changes

Required:

- `test/doctor.test.js`
- `test/cli.test.js`
- `tunelito doctor <target> --json` for a representative target
- read-only coverage proving no comments file, agent state, server, tunnel, or browser is created

Also update:

- README and docs-site CLI reference
- `docs/agents/START_HERE.md`
- `docs/agents/SECURITY_REVIEW.md` when safety checks change

## MCP Changes

Required:

- `test/mcp.test.js`
- `test/agent-worker.test.js` when claim, watch, record, status, policy, or continuation behavior changes
- `test/cli.test.js` when command routing or help changes
- `npm run ci`

Also update:

- README and docs-site CLI or agent workflow pages
- `docs/agents/ARCHITECTURE.md`
- `docs/agents/SECURITY_REVIEW.md`

## Review Handoff Changes

Required:

- `test/server.test.js`
- `test/cli.test.js`
- timeout coverage for `tunelito review watch`
- persistent coverage proving handoff does not corrupt comments markdown or source files
- live-mode coverage proving handoff does not create a comments file
- browser or screenshot verification for the `Done Reviewing` panel control
- `npm run ci`

Also update:

- README and docs-site CLI or agent workflow pages
- bundled `docs-site/skill.md` when agents should use the wait command
- `docs/agents/ARCHITECTURE.md`
- `docs/agents/SECURITY_REVIEW.md`

## Client/UI Changes

Required:

- `npm test`
- inspect injected `/__tunelito/client.js`
- run a local page and verify the injected script appears
- choose relevant fixtures from `docs/agents/EXAMPLE_FIXTURES.md` and verify them in a real browser when available

For mobile, visual, accessibility, screenshot, overlay, or text-selection changes, run the relevant fixture regression set from `docs/agents/EXAMPLE_FIXTURES.md`. Include desktop and mobile viewport checks when layout or overlay placement can change.

For rendered Markdown UI changes, also run:

```bash
npm run browser:check
```

Required Markdown subsets:

- renderer shell or no-heading behavior: `minimal-text.md`, `paragraphs-only.md`, `single-long-paragraph.md`
- front matter or drawer behavior: `frontmatter-flat.md`, `frontmatter-nested.md`, `frontmatter-invalid.md`, `kitchen-sink.md`
- wiki-link behavior or transform boundaries: `kitchen-sink.md`, `markdown-vault/index.md`
- HTML-comment hiding or code boundaries: `html-comments.md`, `kitchen-sink.md`
- document ruler hierarchy/navigation: `paragraphs-only.md`, `heading-ladder.md`, `single-long-paragraph.md`, `kitchen-sink.md`, `ruler-density.md`
- folder/index behavior: serve `examples/markdown-vault/`

The committed-fixture validator and production-renderer smoke run in `npm test`; do not replace them with temporary Markdown strings. Capture real-browser screenshot evidence from the committed fixtures for visual changes. Theme changes must run all packaged themes through `npm run browser:check`; capture a review set with `npm run theme:screenshots`.

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
