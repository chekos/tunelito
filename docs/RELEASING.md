# Releasing Tunelito

Tunelito is currently distributed as a GitHub-installable beta. When the npm package name is ready, use trusted publishing from GitHub Actions so releases do not depend on long-lived npm tokens.

## One-Time npm Setup

1. Claim or create the `tunelito` package on npm.
2. In npm package settings, add a trusted publisher:
   - Provider: GitHub Actions
   - Organization/user: `chekos`
   - Repository: `tunelito`
   - Workflow filename: `publish.yml`
   - Allowed action: `npm publish`
3. Require two-factor authentication and disallow legacy automation tokens after trusted publishing succeeds.

## Beta Release

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
   git tag v0.1.1-beta.2
   git push origin main --tags
   ```

5. Confirm the GitHub Actions publish workflow completed.
6. Install from npm in a clean shell and run a smoke test:

   ```bash
   npm install -g tunelito@beta
   tunelito ./examples/simple-review.html --no-tunnel
   ```

## Provenance

The publish workflow grants `id-token: write` and uses npm trusted publishing. For a public repository and public package, npm will publish provenance attestations automatically.
