import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkRelease } from "../scripts/release-check.mjs";

test("release check accepts stable releases and reports latest dist-tag", async () => {
  const rootDir = fixture("0.1.2");
  const result = await checkRelease({
    versionInput: "v0.1.2",
    rootDir,
    fetchFn: notPublishedFetch,
  });

  assert.deepEqual(result, {
    packageName: "tunelito-fixture",
    version: "0.1.2",
    npmTag: "latest",
    isPrerelease: false,
    published: false,
  });
});

test("release check accepts rc releases and reports rc dist-tag", async () => {
  const rootDir = fixture("0.1.2-rc.0");
  const result = await checkRelease({
    versionInput: "0.1.2-rc.0",
    rootDir,
    fetchFn: notPublishedFetch,
  });

  assert.equal(result.npmTag, "rc");
  assert.equal(result.isPrerelease, true);
});

test("release check accepts beta releases and reports beta dist-tag", async () => {
  const rootDir = fixture("0.1.2-beta.0");
  const result = await checkRelease({
    versionInput: "refs/tags/v0.1.2-beta.0",
    rootDir,
    fetchFn: notPublishedFetch,
  });

  assert.equal(result.version, "0.1.2-beta.0");
  assert.equal(result.npmTag, "beta");
});

test("release check rejects missing changelog headings", async () => {
  const rootDir = fixture("0.1.2", { changelogVersion: "0.1.1" });

  await assert.rejects(
    checkRelease({ versionInput: "0.1.2", rootDir, fetchFn: notPublishedFetch }),
    /CHANGELOG\.md is missing a heading for 0\.1\.2/,
  );
});

test("release check rejects mismatched package versions", async () => {
  const rootDir = fixture("0.1.2", { packageVersion: "0.1.1" });

  await assert.rejects(
    checkRelease({ versionInput: "0.1.2", rootDir, fetchFn: notPublishedFetch }),
    /package\.json version mismatch: expected 0\.1\.2, found 0\.1\.1/,
  );
});

test("release check rejects mismatched package-lock versions", async () => {
  const rootDir = fixture("0.1.2", { lockVersion: "0.1.1" });

  await assert.rejects(
    checkRelease({ versionInput: "0.1.2", rootDir, fetchFn: notPublishedFetch }),
    /package-lock\.json version mismatch: expected 0\.1\.2, found 0\.1\.1/,
  );
});

test("release check rejects already published versions unless allowed", async () => {
  const rootDir = fixture("0.1.2");

  await assert.rejects(
    checkRelease({ versionInput: "0.1.2", rootDir, fetchFn: publishedFetch }),
    /tunelito-fixture@0\.1\.2 is already published on npm/,
  );

  const result = await checkRelease({
    versionInput: "0.1.2",
    rootDir,
    fetchFn: publishedFetch,
    allowPublished: true,
  });
  assert.equal(result.published, true);
});

function fixture(version, { packageVersion = version, lockVersion = packageVersion, changelogVersion = version } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "tunelito-release-check-"));
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({
    name: "tunelito-fixture",
    version: packageVersion,
  }, null, 2));
  writeFileSync(join(rootDir, "package-lock.json"), JSON.stringify({
    name: "tunelito-fixture",
    version: lockVersion,
    lockfileVersion: 3,
    packages: {
      "": {
        name: "tunelito-fixture",
        version: lockVersion,
      },
    },
  }, null, 2));
  writeFileSync(join(rootDir, "CHANGELOG.md"), `# Changelog\n\n## ${changelogVersion}\n\n- Fixture release.\n`);
  return rootDir;
}

async function notPublishedFetch() {
  return { status: 404, statusText: "Not Found" };
}

async function publishedFetch() {
  return { status: 200, statusText: "OK" };
}
