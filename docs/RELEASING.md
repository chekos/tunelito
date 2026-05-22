# Releasing Tunelito

Tunelito is published to npm as a public package. Prefer trusted publishing from GitHub Actions so releases do not depend on long-lived npm tokens.

## One-Time npm Setup

1. Claim or create the `tunelito` package on npm.
2. In npm package settings, add a trusted publisher with npm 11.15 or newer:

   ```bash
   npx --yes npm@11.15.0 trust github tunelito --file publish.yml --repo chekos/tunelito --allow-publish -y
   ```

3. Require two-factor authentication and disallow legacy automation tokens after trusted publishing succeeds.

## npm Release

1. Update `package.json` and `CHANGELOG.md`.
2. Run:

   ```bash
   npm ci
   npm run ci
   npm pack
   npm install -g ./tunelito-*.tgz
   tunelito --version
   ```

3. Commit the release changes.
4. Tag the release:

   ```bash
   git tag v0.1.1
   git push origin main --tags
   ```

5. Confirm the GitHub Actions publish workflow completed.
6. Install from npm in a clean shell and run a smoke test:

   ```bash
   npx --yes tunelito --version
   npx --yes tunelito ./examples/simple-review.html --no-tunnel
   ```

## Provenance

The publish workflow grants `id-token: write` and uses npm trusted publishing. For a public repository and public package, npm will publish provenance attestations automatically.
