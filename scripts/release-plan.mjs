#!/usr/bin/env node

// Decides whether a push to main should cut a release. A release happens
// only when package.json names a version that is not on npm yet and the
// CHANGELOG heading for it carries a date ("## 2.0.1 - 2026-11-12"), not
// "Unreleased". Merging a version PR is therefore the release trigger.

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isVersionPublished } from "./release-check.mjs";
import { parseReleaseVersion } from "./npm-release-tag.mjs";

const DEFAULT_ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

export async function planAutoRelease({ rootDir = DEFAULT_ROOT_DIR, fetchFn = fetch } = {}) {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(rootDir, "package-lock.json"), "utf8"));
  const changelog = await readFile(join(rootDir, "CHANGELOG.md"), "utf8");
  const release = parseReleaseVersion(pkg.version);
  const base = { version: release.version, npmTag: release.npmTag, isPrerelease: release.isPrerelease };

  if (lock.version !== release.version || lock.packages?.[""]?.version !== release.version) {
    throw new Error(`package-lock.json does not match package.json version ${release.version}.`);
  }
  const heading = changelogHeading(changelog, release.version);
  if (!heading) return { ...base, release: false, reason: `CHANGELOG.md has no heading for ${release.version}` };
  if (!/\b\d{4}-\d{2}-\d{2}\b/.test(heading)) {
    return { ...base, release: false, reason: `CHANGELOG.md heading for ${release.version} is not dated` };
  }
  if (await isVersionPublished({ packageName: pkg.name, version: release.version, fetchFn })) {
    return { ...base, release: false, reason: `${pkg.name}@${release.version} is already published` };
  }
  return { ...base, release: true, reason: `${pkg.name}@${release.version} is dated and unpublished` };
}

function changelogHeading(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,6}\\s+\\[?${escaped}\\]?(?:\\s.*)?$`, "m").exec(changelog)?.[0] || "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = await planAutoRelease();
    const lines = [
      `release=${plan.release}`,
      `version=${plan.version}`,
      `npm_tag=${plan.npmTag}`,
      `is_prerelease=${plan.isPrerelease}`,
    ];
    console.log(`${plan.release ? "Release" : "No release"}: ${plan.reason}`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
