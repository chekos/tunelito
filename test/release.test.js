import test from "node:test";
import assert from "node:assert/strict";
import { formatGitHubOutput, normalizeReleaseVersion, parseReleaseVersion } from "../scripts/npm-release-tag.mjs";

test("normalizes release tag names", () => {
  assert.equal(normalizeReleaseVersion("v0.1.2"), "0.1.2");
  assert.equal(normalizeReleaseVersion("refs/tags/v0.1.2-rc.0"), "0.1.2-rc.0");
});

test("stable releases publish to latest", () => {
  assert.deepEqual(parseReleaseVersion("v0.1.2"), {
    version: "0.1.2",
    npmTag: "latest",
    isPrerelease: false,
  });
});

test("prerelease versions publish to their named npm channel", () => {
  assert.deepEqual(parseReleaseVersion("0.1.2-rc.0"), {
    version: "0.1.2-rc.0",
    npmTag: "rc",
    isPrerelease: true,
  });
  assert.deepEqual(parseReleaseVersion("v0.1.2-beta.3"), {
    version: "0.1.2-beta.3",
    npmTag: "beta",
    isPrerelease: true,
  });
});

test("release output is GitHub Actions compatible", () => {
  assert.equal(formatGitHubOutput(parseReleaseVersion("v0.1.2-rc.0")), [
    "version=0.1.2-rc.0",
    "npm_tag=rc",
    "is_prerelease=true",
  ].join("\n"));
});

test("rejects non-npm prerelease spellings", () => {
  assert.throws(() => parseReleaseVersion("0.1.2rc0"), /Use "0\.1\.2-rc\.0" instead/);
});

test("rejects unnamed numeric prerelease channels", () => {
  assert.throws(() => parseReleaseVersion("0.1.2-0"), /named channel/);
});
