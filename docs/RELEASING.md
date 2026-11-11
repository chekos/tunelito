# Releasing Tunelito

Tunelito is published to npm as a public package. Prefer trusted publishing from GitHub Actions so releases do not depend on long-lived npm tokens.

## CLI contract v2 (2.0.0)

The 2.0.0 package metadata includes breaking CLI changes: human serve output
moves to stderr, machine failures use `tunelito-error` schemaVersion `2` JSON
on stderr, and SIGINT/SIGTERM/SIGHUP exit `130`/`143`/`129`. Serve stdout remains
typed timestamped JSONL in machine mode. The README's migration section is the
consumer contract; include these changes in release notes and preserve the
1.x npm version for integrations that need time to migrate.

Merging the version PR does not publish the package. Publish only through the
release workflow below. The bundled skill changes with this contract, so the
release also requires the byte-for-byte BNS Marketplace sync and writing plugin
version bump described in `docs/agents/RELEASE_PLAYBOOK.md`.

## One-Time npm Setup

1. Claim or create the `tunelito` package on npm.
2. In npm package settings, add a trusted publisher with npm 11.15 or newer:

   ```bash
   npx --yes npm@11.15.0 trust github tunelito --file publish.yml --repo chekos/tunelito --allow-publish -y
   ```

3. Require two-factor authentication and disallow legacy automation tokens after trusted publishing succeeds.

## Automatic release on merge (default)

Merging a version PR is the release. On every push to `main`, the `Publish Package` workflow runs `scripts/release-plan.mjs`. When `package.json` names a version that is not on npm yet and its `CHANGELOG.md` heading is dated (`## 2.0.1 - 2026-11-12`, not `Unreleased`), the workflow runs `npm run ci`, creates the `vX.Y.Z` GitHub Release with generated notes, and publishes to npm through trusted publishing. Any other push is a no-op. No manual dispatch, draft review, or "Publish release" click is needed, so an agent can ship a release by merging a PR.

To release:

1. In a PR, set the version in `package.json` and `package-lock.json`, and date its `CHANGELOG.md` heading. Keep the heading `Unreleased` while work is still accumulating; an undated heading never releases.
2. Run `npm run release:check -- <version>` and `npm run ci`.
3. Merge the PR. Watch the `Publish Package` run on the merge commit.
4. Smoke the install (below), then sync the skill to BNS Marketplace (`docs/agents/RELEASE_PLAYBOOK.md`).

The manual path below still works: publishing a GitHub Release by hand also triggers `Publish Package`, which skips npm when that version already exists.

## Manual npm Release

All code and version changes must land through a pull request before a release is created.

1. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` in a PR.
2. Use npm-valid semver versions:
   - Stable: `0.1.2`, released to npm as `latest`.
   - Release candidate: `0.1.2-rc.0`, released to npm as `rc`.
   - Beta: `0.1.2-beta.0`, released to npm as `beta`.
3. Run:

   ```bash
   npm ci
   npm run release:check -- 0.1.2
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
   npm run release:check -- 0.1.2-rc.0
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

10. Update the maintainer machine's global install to the exact released version:

    ```bash
    npm install -g tunelito@0.1.2
    tunelito --version
    ```

## npm Tags

The publish workflow derives the npm dist-tag from the GitHub Release tag:

| GitHub Release tag | package version | npm dist-tag |
| --- | --- | --- |
| `v0.1.2` | `0.1.2` | `latest` |
| `v0.1.2-rc.0` | `0.1.2-rc.0` | `rc` |
| `v0.1.2-beta.0` | `0.1.2-beta.0` | `beta` |

Do not use compact prerelease spellings like `0.1.2rc0`; npm package versions use semver prerelease syntax such as `0.1.2-rc.0`.

`npm run release:check -- <version-or-tag>` verifies the package metadata, lockfile, changelog heading, npm dist-tag, and npm publication status before a GitHub Release is drafted. It fails when the exact version already exists on npm; use `--allow-published` only for a deliberate re-check of an already-published version.

## Provenance

The publish workflow grants `id-token: write` and uses npm trusted publishing. For a public repository and public package, npm will publish provenance attestations automatically.
