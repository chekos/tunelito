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

All code and version changes must land through a pull request before a release is created.

1. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` in a PR.
2. Use npm-valid semver versions:
   - Stable: `0.1.2`, released to npm as `latest`.
   - Release candidate: `0.1.2-rc.0`, released to npm as `rc`.
   - Beta: `0.1.2-beta.0`, released to npm as `beta`.
3. Run:

   ```bash
   npm ci
   npm run ci
   npm pack
   npm install -g ./tunelito-*.tgz
   tunelito --version
   ```

4. Merge the PR to `main`.
5. Create a draft GitHub Release from the merged commit:

   ```bash
   gh workflow run "Draft Release" -f version=0.1.2
   ```

   For release candidates, use the npm semver prerelease form:

   ```bash
   gh workflow run "Draft Release" -f version=0.1.2-rc.0
   ```

6. Review the generated GitHub Release notes. They are generated from merged pull requests and grouped by `.github/release.yml`.
7. Publish the GitHub Release. The `Publish Package` workflow publishes the package to npm through trusted publishing.
8. Confirm the GitHub Actions publish workflow completed.
9. Install from npm in a clean shell and run a smoke test:

   ```bash
   npx --yes tunelito --version
   npx --yes tunelito ./examples/simple-review.html --no-tunnel
   ```

## npm Tags

The publish workflow derives the npm dist-tag from the GitHub Release tag:

| GitHub Release tag | package version | npm dist-tag |
| --- | --- | --- |
| `v0.1.2` | `0.1.2` | `latest` |
| `v0.1.2-rc.0` | `0.1.2-rc.0` | `rc` |
| `v0.1.2-beta.0` | `0.1.2-beta.0` | `beta` |

Do not use compact prerelease spellings like `0.1.2rc0`; npm package versions use semver prerelease syntax such as `0.1.2-rc.0`.

## Provenance

The publish workflow grants `id-token: write` and uses npm trusted publishing. For a public repository and public package, npm will publish provenance attestations automatically.
