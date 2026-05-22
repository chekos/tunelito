#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseReleaseVersion(input) {
  if (!input) throw new Error("A release tag or version is required.");

  const version = normalizeReleaseVersion(input);
  const match = version.match(VERSION_PATTERN);
  if (!match) {
    if (/^\d+\.\d+\.\d+[A-Za-z]/.test(version)) {
      throw new Error(`Invalid npm semver prerelease "${version}". Use "${version.replace(/^(\d+\.\d+\.\d+)([A-Za-z]+)(\d+)$/, "$1-$2.$3")}" instead.`);
    }
    throw new Error(`Invalid npm semver version: ${version}`);
  }

  const prerelease = match[4] || "";
  const isPrerelease = Boolean(prerelease);
  const npmTag = isPrerelease ? npmTagFromPrerelease(prerelease) : "latest";

  return {
    version,
    npmTag,
    isPrerelease,
  };
}

export function normalizeReleaseVersion(input) {
  return String(input).trim().replace(/^refs\/tags\//, "").replace(/^v(?=\d+\.\d+\.\d+)/, "");
}

function npmTagFromPrerelease(prerelease) {
  const channel = prerelease.split(".")[0];
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(channel) || /^v\d*$/i.test(channel)) {
    throw new Error(`Invalid prerelease channel "${channel}". Start prerelease versions with a named channel like rc, beta, or alpha.`);
  }
  return channel.toLowerCase();
}

export function formatGitHubOutput({ version, npmTag, isPrerelease }) {
  return [
    `version=${version}`,
    `npm_tag=${npmTag}`,
    `is_prerelease=${isPrerelease ? "true" : "false"}`,
  ].join("\n");
}

if (isCliEntry(import.meta.url)) {
  try {
    console.log(formatGitHubOutput(parseReleaseVersion(process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function isCliEntry(metaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath && metaUrl === pathToFileURL(argvPath).href);
}
