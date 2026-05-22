#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseReleaseVersion } from "./npm-release-tag.mjs";

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

export async function checkRelease({
  versionInput,
  allowPublished = false,
  rootDir = DEFAULT_ROOT_DIR,
  fetchFn = fetch,
  registryUrl = DEFAULT_REGISTRY_URL,
} = {}) {
  const release = parseReleaseVersion(versionInput);
  const pkg = await readJson(join(rootDir, "package.json"));
  const lock = await readJson(join(rootDir, "package-lock.json"));
  const changelog = await readFile(join(rootDir, "CHANGELOG.md"), "utf8");

  assertEqualVersion("package.json", pkg.version, release.version);
  assertEqualVersion("package-lock.json", lock.version, release.version);
  assertEqualVersion("package-lock.json root package", lock.packages?.[""]?.version, release.version);
  assertChangelogHeading(changelog, release.version);

  const published = await isVersionPublished({
    packageName: pkg.name,
    version: release.version,
    fetchFn,
    registryUrl,
  });

  if (published && !allowPublished) {
    throw new Error(`${pkg.name}@${release.version} is already published on npm. Pass --allow-published to continue.`);
  }

  return {
    packageName: pkg.name,
    version: release.version,
    npmTag: release.npmTag,
    isPrerelease: release.isPrerelease,
    published,
  };
}

export async function isVersionPublished({
  packageName,
  version,
  fetchFn = fetch,
  registryUrl = DEFAULT_REGISTRY_URL,
}) {
  if (!packageName) throw new Error("package.json is missing a package name.");

  const base = registryUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
  const response = await fetchFn(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`Could not verify npm publication status for ${packageName}@${version} (${response.status} ${response.statusText || "Unknown"})`);
}

export function assertChangelogHeading(changelog, version) {
  const escaped = escapeRegex(version);
  const heading = new RegExp(`^#{2,6}\\s+\\[?${escaped}\\]?(?:\\s|$)`, "m");
  if (!heading.test(changelog)) {
    throw new Error(`CHANGELOG.md is missing a heading for ${version}.`);
  }
}

function assertEqualVersion(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} version mismatch: expected ${expected}, found ${actual || "missing"}.`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseArgs(argv) {
  const opts = {
    allowPublished: false,
    rootDir: DEFAULT_ROOT_DIR,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-published") {
      opts.allowPublished = true;
    } else if (arg === "--root") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--root requires a value");
      opts.rootDir = resolve(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    throw new Error("Usage: npm run release:check -- <version-or-tag> [--allow-published] [--root <path>]");
  }

  return {
    ...opts,
    versionInput: positional[0],
  };
}

function formatResult(result) {
  return [
    `Release check passed for ${result.packageName}@${result.version}`,
    `npm dist-tag: ${result.npmTag}`,
    `npm registry: ${result.published ? "already published (allowed)" : "not published"}`,
  ].join("\n");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCliEntry(metaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath && metaUrl === pathToFileURL(argvPath).href);
}

if (isCliEntry(import.meta.url)) {
  try {
    const result = await checkRelease(parseArgs(process.argv.slice(2)));
    console.log(formatResult(result));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
