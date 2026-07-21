import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { normalizeMarkdownCssHref } from "./markdown.js";
import { DEFAULT_THEME_NAME, THEME_DETAILS, THEME_NAMES, normalizeThemeName } from "./themes.js";

export const PROJECT_CONFIG_FILENAME = "tunelito.config.json";
export const CONFIG_FORMAT = "tunelito-config";
export const CONFIG_VERSION = 1;
const CONFIG_KEYS = new Set(["theme", "markdownCss"]);

export function resolveTunelitoConfig({
  targetPath = process.cwd(),
  cliTheme,
  cliThemeProvided = false,
  cliMarkdownCss,
  cliMarkdownCssProvided = false,
  env = process.env,
  homePath = homedir(),
} = {}) {
  const resolvedTarget = resolve(targetPath);
  const projectRoot = targetRoot(resolvedTarget);
  const globalConfigPath = resolveGlobalConfigPath({ env, homePath });
  const projectConfigPath = join(projectRoot, PROJECT_CONFIG_FILENAME);
  const globalConfig = readConfigFile(globalConfigPath, "global");
  const projectConfig = readConfigFile(projectConfigPath, "project");

  const themeCandidate = pickValue({
    key: "theme",
    cliProvided: cliThemeProvided,
    cliValue: cliTheme,
    projectConfig,
    globalConfig,
    defaultValue: DEFAULT_THEME_NAME,
  });
  const theme = normalizeThemeName(themeCandidate.value);

  const cssCandidate = pickValue({
    key: "markdownCss",
    cliProvided: cliMarkdownCssProvided,
    cliValue: cliMarkdownCss,
    projectConfig,
    globalConfig,
    defaultValue: "",
  });
  const markdownCss = resolveMarkdownCss(cssCandidate);

  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    targetPath: resolvedTarget,
    projectRoot,
    configPaths: {
      global: globalConfigPath,
      project: projectConfigPath,
    },
    theme: {
      value: theme,
      source: themeCandidate.source,
      configPath: themeCandidate.configPath || null,
      details: THEME_DETAILS[theme],
    },
    markdownCss: {
      value: cssCandidate.value || "",
      source: cssCandidate.source,
      configPath: cssCandidate.configPath || null,
      kind: markdownCss.kind,
      resolved: markdownCss.path || markdownCss.href || "",
    },
    markdownCssHref: markdownCss.href,
    markdownCssText: markdownCss.text,
    blockedPaths: projectConfig.exists ? [projectConfigPath] : [],
    availableThemes: THEME_NAMES.map((name) => ({
      name,
      ...THEME_DETAILS[name],
    })),
  };
}

export function resolveGlobalConfigPath({ env = process.env, homePath = homedir() } = {}) {
  const configRoot = String(env.XDG_CONFIG_HOME || "").trim()
    ? resolve(String(env.XDG_CONFIG_HOME))
    : join(resolve(homePath), ".config");
  return join(configRoot, "tunelito", "config.json");
}

function targetRoot(targetPath) {
  try {
    return statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
  } catch {
    return dirname(targetPath);
  }
}

function readConfigFile(path, layer) {
  if (!existsSync(path)) return { exists: false, path, layer, values: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${layer} Tunelito config at ${path}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${layer} Tunelito config at ${path}: expected a JSON object`);
  }
  const unknownKeys = Object.keys(parsed).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(`Invalid ${layer} Tunelito config at ${path}: unknown ${unknownKeys.length === 1 ? "setting" : "settings"} ${unknownKeys.map((key) => `"${key}"`).join(", ")}`);
  }
  for (const key of ["theme", "markdownCss"]) {
    if (key in parsed && typeof parsed[key] !== "string") {
      throw new Error(`Invalid ${layer} Tunelito config at ${path}: "${key}" must be a string`);
    }
  }
  if (parsed.theme) normalizeThemeName(parsed.theme);
  return { exists: true, path, layer, values: parsed };
}

function pickValue({ key, cliProvided, cliValue, projectConfig, globalConfig, defaultValue }) {
  if (cliProvided) return { value: cliValue ?? "", source: "cli" };
  if (Object.hasOwn(projectConfig.values, key)) {
    return { value: projectConfig.values[key], source: "project", configPath: projectConfig.path };
  }
  if (Object.hasOwn(globalConfig.values, key)) {
    return { value: globalConfig.values[key], source: "global", configPath: globalConfig.path };
  }
  return { value: defaultValue, source: "default" };
}

function resolveMarkdownCss(candidate) {
  const value = String(candidate.value || "").trim();
  if (!value) return { kind: "none", href: "", text: "", path: "" };
  if (candidate.source === "cli") {
    return {
      kind: "href",
      href: normalizeMarkdownCssHref(value),
      text: "",
      path: "",
    };
  }
  if (/^https?:\/\//i.test(value)) {
    return {
      kind: "href",
      href: normalizeMarkdownCssHref(value),
      text: "",
      path: "",
    };
  }

  const configDir = dirname(candidate.configPath);
  const cssPath = isAbsolute(value) ? resolve(value) : resolve(configDir, value);
  let text;
  try {
    text = readFileSync(cssPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read Markdown CSS from ${candidate.source} config ${candidate.configPath}: ${cssPath} (${error.message})`);
  }
  return { kind: "file", href: "", text, path: cssPath };
}
