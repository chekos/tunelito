#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const binName = process.platform === "win32" ? "tunelito.cmd" : "tunelito";
const tempRoot = mkdtempSync(join(tmpdir(), "tunelito-package-smoke-"));

try {
  const packDir = join(tempRoot, "pack");
  const prefixDir = join(tempRoot, "prefix");
  const execDir = join(tempRoot, "exec");
  mkdirSync(packDir);
  mkdirSync(prefixDir);
  mkdirSync(execDir);

  run(npmCommand, ["pack", "--pack-destination", packDir], { cwd: rootDir });
  const tarball = findTarball(packDir);

  run(npmCommand, ["install", "-g", "--prefix", prefixDir, tarball], { cwd: execDir });
  const installedBin = process.platform === "win32" ? join(prefixDir, binName) : join(prefixDir, "bin", binName);
  assertVersion(run(installedBin, ["--version"], { cwd: execDir }), "global tarball install");
  assertSkill(run(installedBin, ["skill", "show"], { cwd: execDir }), "global tarball install");
  assertSkillSetup(run(installedBin, ["skill", "setup"], { cwd: execDir }), "global tarball install");
  assertSkillInstall(run(installedBin, ["skill", "install", "--agent", "codex", "--scope", "project", "--project-root", execDir, "--dry-run"], { cwd: execDir }), "global tarball install");
  assertMermaidDependency(prefixDir);

  assertVersion(
    run(npxCommand, ["--yes", "--package", tarball, "--", "tunelito", "--version"], { cwd: execDir }),
    "npx tarball execution",
  );

  assertVersion(
    run(npmCommand, ["exec", "--yes", "--package", tarball, "--", "tunelito", "--version"], { cwd: execDir }),
    "npm exec tarball execution",
  );

  console.log(`Package smoke check passed for ${pkg.name}@${pkg.version}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function findTarball(packDir) {
  const tarballs = readdirSync(packDir).filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one packed tarball in ${packDir}, found ${tarballs.length}`);
  }
  return join(packDir, tarballs[0]);
}

function run(command, args, { cwd }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_loglevel: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }

  return result.stdout.trim();
}

function assertVersion(output, label) {
  if (output !== pkg.version) {
    throw new Error(`${label} returned ${JSON.stringify(output)}; expected ${pkg.version}`);
  }
}

function assertSkill(output, label) {
  if (!output.includes("name: tunelito")) {
    throw new Error(`${label}: "tunelito skill show" did not print the bundled SKILL.md`);
  }
}

function assertSkillSetup(output, label) {
  if (!output.includes("Tunelito agent setup") || !output.includes("npx --yes tunelito skill show")) {
    throw new Error(`${label}: "tunelito skill setup" did not print setup guidance`);
  }
}

function assertSkillInstall(output, label) {
  if (!output.includes("Tunelito skill install") || !output.includes("Action:") || !output.includes("would-create")) {
    throw new Error(`${label}: "tunelito skill install --dry-run" did not report its proposed action`);
  }
}

function assertMermaidDependency(prefixDir) {
  const dependencyPath = process.platform === "win32"
    ? join(prefixDir, "node_modules", "tunelito", "node_modules", "mermaid", "dist", "mermaid.min.js")
    : join(prefixDir, "lib", "node_modules", "tunelito", "node_modules", "mermaid", "dist", "mermaid.min.js");
  if (!existsSync(dependencyPath)) {
    throw new Error(`global tarball install did not include the Mermaid browser runtime at ${dependencyPath}`);
  }
}
