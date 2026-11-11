import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planAutoRelease } from "../scripts/release-plan.mjs";

function fixture(version, heading) {
  const rootDir = mkdtempSync(join(tmpdir(), "tunelito-release-plan-"));
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({ name: "tunelito-fixture", version }));
  writeFileSync(join(rootDir, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
  writeFileSync(join(rootDir, "CHANGELOG.md"), `# Changelog\n\n${heading}\n\n- Change.\n`);
  return rootDir;
}

const registry = (status) => async () => ({ status, statusText: "" });

test("a dated, unpublished version releases on push", async () => {
  const plan = await planAutoRelease({ rootDir: fixture("2.0.1", "## 2.0.1 - 2026-11-12"), fetchFn: registry(404) });
  assert.equal(plan.release, true);
  assert.equal(plan.npmTag, "latest");
  assert.equal(plan.isPrerelease, false);
});

test("an Unreleased changelog heading does not release", async () => {
  const plan = await planAutoRelease({ rootDir: fixture("2.0.1", "## 2.0.1 - Unreleased"), fetchFn: registry(404) });
  assert.equal(plan.release, false);
  assert.match(plan.reason, /not dated/);
});

test("an already published version does not release", async () => {
  const plan = await planAutoRelease({ rootDir: fixture("2.0.0", "## 2.0.0 - 2026-11-11"), fetchFn: registry(200) });
  assert.equal(plan.release, false);
  assert.match(plan.reason, /already published/);
});

test("prerelease versions keep their npm dist-tag", async () => {
  const plan = await planAutoRelease({ rootDir: fixture("2.1.0-rc.0", "## 2.1.0-rc.0 - 2026-11-12"), fetchFn: registry(404) });
  assert.equal(plan.release, true);
  assert.equal(plan.npmTag, "rc");
  assert.equal(plan.isPrerelease, true);
});

test("a missing heading or mismatched lockfile does not release", async () => {
  const missing = await planAutoRelease({ rootDir: fixture("2.0.1", "## 2.0.0 - 2026-11-11"), fetchFn: registry(404) });
  assert.equal(missing.release, false);
  const rootDir = fixture("2.0.1", "## 2.0.1 - 2026-11-12");
  writeFileSync(join(rootDir, "package-lock.json"), JSON.stringify({ version: "2.0.0", packages: { "": { version: "2.0.0" } } }));
  await assert.rejects(planAutoRelease({ rootDir, fetchFn: registry(404) }), /package-lock\.json does not match/);
});
