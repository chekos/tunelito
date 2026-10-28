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

test("linkPreviews layers like other settings and validates each rule", () => {
  const paths = workspace();
  const globalRule = { match: "^g:(\\d+)$", resolver: "http://127.0.0.1:3100/g/{1}" };
  const projectRule = {
    match: "^http://127\\.0\\.0\\.1:3100/TLL/issues/(?<id>TLL-\\d+)$",
    resolver: "http://127.0.0.1:3100/api/issues/{id}",
    fields: { status: "state.name" },
  };
  writeFileSync(paths.globalConfigPath, JSON.stringify({ linkPreviews: [globalRule] }));

  const globalOnly = resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} });
  assert.equal(globalOnly.linkPreviews.source, "global");
  assert.deepEqual(globalOnly.linkPreviews.rules.map((rule) => rule.match), [globalRule.match]);

  writeFileSync(paths.projectConfigPath, JSON.stringify({ linkPreviews: [projectRule] }));
  const project = resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} });
  assert.equal(project.linkPreviews.source, "project");
  assert.deepEqual(project.linkPreviews.rules, [{
    match: projectRule.match,
    resolver: projectRule.resolver,
    fields: { title: "title", status: "state.name", priority: "priority" },
  }]);
  assert.equal(project.linkPreviewRules[0].origin, "http://127.0.0.1:3100");

  const cli = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
    cliLinkPreviews: [{ match: "^c$", resolver: "http://localhost:1/c" }],
    cliLinkPreviewsProvided: true,
  });
  assert.equal(cli.linkPreviews.source, "cli");
  assert.deepEqual(cli.linkPreviews.rules.map((rule) => rule.match), ["^c$"]);

  const defaults = resolveTunelitoConfig({ targetPath: join(paths.root, "elsewhere.md"), homePath: join(paths.root, "nohome"), env: {} });
  assert.deepEqual(defaults.linkPreviews, { source: "default", configPath: null, rules: [] });

  writeFileSync(paths.projectConfigPath, JSON.stringify({ linkPreviews: [{ match: "x", resolver: "http://{1}/" }] }));
  assert.throws(
    () => resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} }),
    new RegExp(`Invalid project Tunelito config at ${escapeRegex(paths.projectConfigPath)}: linkPreviews\\[0\\]\\.resolver cannot use placeholders`),
  );
});

test("codeWrap defaults on and follows CLI over project over global", () => {
  const paths = workspace();
  const defaults = resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} });
  assert.deepEqual(defaults.codeWrap, { value: true, source: "default", configPath: null });

  writeFileSync(paths.globalConfigPath, JSON.stringify({ codeWrap: false }));
  const global = resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} });
  assert.deepEqual(global.codeWrap, { value: false, source: "global", configPath: paths.globalConfigPath });

  writeFileSync(paths.projectConfigPath, JSON.stringify({ codeWrap: true }));
  const project = resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} });
  assert.deepEqual(project.codeWrap, { value: true, source: "project", configPath: paths.projectConfigPath });

  const cli = resolveTunelitoConfig({
    targetPath: paths.targetPath,
    homePath: paths.homePath,
    env: {},
    cliCodeWrap: false,
    cliCodeWrapProvided: true,
  });
  assert.deepEqual(cli.codeWrap, { value: false, source: "cli", configPath: null });

  writeFileSync(paths.projectConfigPath, JSON.stringify({ codeWrap: "off" }));
  assert.throws(
    () => resolveTunelitoConfig({ targetPath: paths.targetPath, homePath: paths.homePath, env: {} }),
    new RegExp(`Invalid project Tunelito config at ${escapeRegex(paths.projectConfigPath)}: "codeWrap" must be true or false`),
  );
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
