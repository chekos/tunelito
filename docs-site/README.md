# Tunelito Mintlify Docs

This directory is the Mintlify documentation root.

Preview locally:

```bash
npm run docs:dev
```

Validate locally:

```bash
npm run docs:check
```

Run the Mintlify CLI validation when you are on a Mintlify-supported LTS Node runtime:

```bash
npm run docs:validate
```

The current package supports Node.js 22 and newer, but Mintlify's CLI may lag newly released non-LTS Node versions. If `docs:validate` reports that the local Node version is unsupported, switch to Node 22 or 24 for the Mintlify CLI pass and keep `npm run docs:check` as the repo-local gate.

In the Mintlify dashboard, configure this repository as a monorepo and set the documentation path to:

```text
/docs-site
```

Mintlify will deploy from the `docs.json` file in this directory.
