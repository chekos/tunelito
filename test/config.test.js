import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FORMAT,
  CONFIG_VERSION,
  PROJECT_CONFIG_FILENAME,
  resolveTunelitoConfig,
} from "../src/config.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "tunelito-config-"));
  const homePath = join(root, "home");
  const projectPath = join(root, "project");
  mkdirSync(join(homePath, ".config", "tunelito"), { recursive: true });
  mkdirSync(projectPath, { recursive: true });
  const targetPath = join(projectPath, "notes.md");
  writeFileSync(targetPath, "# Notes");
  return {
    root,
    homePath,
    projectPath,
    targetPath,
    globalConfigPath: join(homePath, ".config", "tunelito", "config.json"),
    projectConfigPath: join(projectPath, PROJECT_CONFIG_FILENAME),
  };
}

test("resolveTunelitoConfig reports stable defaults and available themes", () => {
  const paths = workspace();
  const config = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
  });

  assert.equal(config.format, CONFIG_FORMAT);
  assert.equal(config.version, CONFIG_VERSION);
  assert.deepEqual(config.theme, {
    value: "bns-pitaya",
    source: "default",
    configPath: null,
    details: {
      description: "A dark reading theme adapted from BNS Obsidian Pitaya without bundled or network fonts.",
      colorModes: ["dark"],
    },
  });
  assert.equal(config.markdownCss.kind, "none");
  assert.deepEqual(config.availableThemes.map(({ name }) => name), [
    "default",
    "editorial",
    "technical",
    "bns-pitaya",
  ]);
});

test("configuration precedence is CLI over project over global over defaults", () => {
  const paths = workspace();
  writeFileSync(paths.globalConfigPath, JSON.stringify({ theme: "editorial" }));
  const projectSource = JSON.stringify({ theme: "technical" });
  writeFileSync(paths.projectConfigPath, projectSource);

  const project = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
  });
  assert.equal(project.theme.value, "technical");
  assert.equal(project.theme.source, "project");
  assert.deepEqual(project.blockedPaths, [paths.projectConfigPath]);

  const cli = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
    cliTheme: "bns-pitaya",
    cliThemeProvided: true,
  });
  assert.equal(cli.theme.value, "bns-pitaya");
  assert.equal(cli.theme.source, "cli");
  assert.equal(readFileSync(paths.projectConfigPath, "utf8"), projectSource);

  const folder = resolveTunelitoConfig({
    targetPath: paths.projectPath,
    homePath: paths.homePath,
    env: {},
  });
  assert.equal(folder.theme.value, project.theme.value);
  assert.equal(folder.theme.source, "project");
});

test("config-relative CSS is loaded after theme resolution and CLI CSS replaces it", () => {
  const paths = workspace();
  const cssPath = join(paths.projectPath, "review.css");
  writeFileSync(cssPath, ".tunelito-markdown { max-width: 55rem; }");
  writeFileSync(paths.projectConfigPath, JSON.stringify({ markdownCss: "./review.css" }));

  const project = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
  });
  assert.equal(project.markdownCss.kind, "file");
  assert.equal(project.markdownCss.resolved, cssPath);
  assert.match(project.markdownCssText, /55rem/);
  assert.equal(project.markdownCssHref, "");

  const cli = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
    cliMarkdownCss: "/final.css",
    cliMarkdownCssProvided: true,
  });
  assert.equal(cli.markdownCss.source, "cli");
  assert.equal(cli.markdownCss.kind, "href");
  assert.equal(cli.markdownCssHref, "/final.css");
  assert.equal(cli.markdownCssText, "");
});

test("invalid config and unknown themes fail with the owning file path", () => {
  const paths = workspace();
  writeFileSync(paths.globalConfigPath, "{ broken");
  assert.throws(
    () => resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} }),
    new RegExp(`Invalid global Tunelito config at ${escapeRegex(paths.globalConfigPath)}`),
  );

  writeFileSync(paths.globalConfigPath, JSON.stringify({ theme: "default" }));
  writeFileSync(paths.projectConfigPath, JSON.stringify({ theme: "unknown" }));
  assert.throws(
    () => resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} }),
    /Unknown theme "unknown".*default, editorial, technical, bns-pitaya/,
  );

  writeFileSync(paths.projectConfigPath, JSON.stringify({ them: "editorial" }));
  assert.throws(
    () => resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} }),
    new RegExp(`Invalid project Tunelito config at ${escapeRegex(paths.projectConfigPath)}: unknown setting "them"`),
  );
});

test("XDG_CONFIG_HOME controls the global config location", () => {
  const paths = workspace();
  const xdgPath = join(paths.root, "xdg");
  mkdirSync(join(xdgPath, "tunelito"), { recursive: true });
  writeFileSync(join(xdgPath, "tunelito", "config.json"), JSON.stringify({ theme: "editorial" }));

  const config = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: { XDG_CONFIG_HOME: xdgPath },
  });
  assert.equal(config.theme.value, "editorial");
  assert.equal(config.configPaths.global, join(xdgPath, "tunelito", "config.json"));
});

test("configuration resolution never creates user or project files", () => {
  const paths = workspace();
  const config = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
  });

  assert.equal(existsSync(config.configPaths.global), false);
  assert.equal(existsSync(config.configPaths.project), false);
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
