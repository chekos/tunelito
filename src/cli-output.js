import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import process from "node:process";

// Terminal presentation helpers shared by the Tunelito CLI. Everything here is
// pure or stream-scoped so tests can render exact text without a TTY.

const ANSI = {
  bold: ["\u001b[1m", "\u001b[22m"],
  dim: ["\u001b[2m", "\u001b[22m"],
  red: ["\u001b[31m", "\u001b[39m"],
  green: ["\u001b[32m", "\u001b[39m"],
  yellow: ["\u001b[33m", "\u001b[39m"],
};

// Escape rather than delete controls so forged terminal instructions remain
// inspectable. Records and JSON are never passed through this renderer.
export function terminalText(value, { multiline = false } = {}) {
  return String(value ?? "").replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (char) => {
    if (char === "\n" && multiline) return char;
    if (char === "\n") return "\\n";
    if (char === "\t") return "\\t";
    if (char === "\r") return "\\r";
    const code = char.codePointAt(0);
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u{${code.toString(16)}}`;
  });
}

export function colorEnabled({ stream = process.stdout, env = process.env, noColor = false } = {}) {
  if (noColor) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined) return !["0", "false"].includes(env.FORCE_COLOR);
  if (!stream?.isTTY) return false;
  if (env.TERM === "dumb") return false;
  if (env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI !== "false") return false;
  return true;
}

export function presentationEnabled({ stream = process.stderr, env = process.env, plain = false, accessible = false } = {}) {
  return Boolean(stream?.isTTY && !plain && !accessible && env.TERM !== "dumb"
    && !env.CI && !env.TUNELITO_PLAIN);
}

export function createStyle(options = {}) {
  const enabled = typeof options === "boolean" ? options : colorEnabled(options);
  const wrap = ([open, close]) => (text) => {
    const safe = terminalText(text, { multiline: true });
    return enabled ? `${open}${safe}${close}` : safe;
  };
  return {
    enabled,
    bold: wrap(ANSI.bold),
    dim: wrap(ANSI.dim),
    red: wrap(ANSI.red),
    green: wrap(ANSI.green),
    yellow: wrap(ANSI.yellow),
  };
}

export const plainStyle = createStyle(false);

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, "");
}

// Show paths the way a person typed them: relative to the working directory
// when inside it, ~-prefixed under home, absolute otherwise.
export function displayPath(path, { cwd = process.cwd(), home = homedir() } = {}) {
  if (!path) return "";
  const value = String(path);
  if (!isAbsolute(value)) return value;
  const fromCwd = relative(cwd, value);
  if (fromCwd === "") return ".";
  if (!fromCwd.startsWith("..") && !isAbsolute(fromCwd)) return fromCwd;
  if (home) {
    const fromHome = relative(home, value);
    if (fromHome === "") return "~";
    if (!fromHome.startsWith("..") && !isAbsolute(fromHome)) return `~${sep}${fromHome}`;
  }
  return value;
}

// Aligned label/value rows. Each row: { label, value, hint?, tone? }.
// tone colors the value: "strong" | "warn" | "error" | "muted".
export function formatRows(rows, style = plainStyle, { indent = "  ", gap = 3, labelWidth, columns = 0 } = {}) {
  const visible = rows.filter(Boolean);
  const width = Math.max(labelWidth || 0, ...visible.map((row) => row.label.length));
  return visible.map((row) => {
    const label = terminalText(row.label).padEnd(width + gap);
    const value = toneValue(terminalText(row.value), row.tone, style);
    const hint = row.hint ? `   ${terminalText(row.hint)}` : "";
    const line = `${indent}${label}${value}${hint}`;
    if (!columns || displayWidth(stripAnsi(line)) < columns) return line;
    // Stack rows at narrow widths. Keep URLs, paths and runnable commands
    // intact: terminals may wrap them, but the only copy is never truncated.
    return `${indent}${terminalText(row.label)}\n${indent}  ${value}${hint ? `\n${indent}  ${terminalText(row.hint)}` : ""}`;
  });
}

export function toneValue(value, tone, style = plainStyle) {
  value = terminalText(value);
  if (tone === "strong") return style.bold(value);
  if (tone === "warn") return style.yellow(value);
  if (tone === "error") return style.red(value);
  if (tone === "success") return style.green(value);
  if (tone === "muted") return style.dim(value);
  return String(value);
}

export const EVENT_VERB_WIDTH = 8;

export function formatClock(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// One runtime event per line: "14:03  comment  Ana: the hero copy…"
export function formatEvent(verb, text, { style = plainStyle, now = new Date(), tone } = {}) {
  const coloredVerb = toneValue(terminalText(verb).padEnd(EVENT_VERB_WIDTH), tone, style);
  return `${style.dim(formatClock(now))}  ${coloredVerb} ${terminalText(text)}`;
}

export function displayWidth(value) {
  return Array.from(String(value)).reduce((width, char) => {
    if (/\p{Mark}/u.test(char)) return width;
    const n = char.codePointAt(0);
    return width + ((n >= 0x1100 && (n <= 0x115f || n >= 0x2e80)) ? 2 : 1);
  }, 0);
}

export function truncate(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${terminalText(count)} ${count === 1 ? singular : pluralForm}`;
}

// Optimal string alignment distance: a swapped pair ("--opne") costs one edit,
// which is how people actually mistype flags.
export function editDistance(a, b) {
  const left = String(a);
  const right = String(b);
  const rows = Array.from({ length: left.length + 1 }, (_, i) => Array.from({ length: right.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

export function closestMatch(input, candidates, { maxDistance } = {}) {
  const value = String(input || "");
  if (!value) return null;
  const limit = maxDistance ?? Math.max(1, Math.min(3, Math.floor(value.length / 3)));
  let best = null;
  for (const candidate of candidates) {
    if (candidate === value) return candidate;
    const distance = editDistance(value, candidate);
    if (distance <= limit && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best?.candidate || null;
}

// Suggest a sibling file for a missing target: same stem with a servable
// extension, or a near-miss name in the same folder.
export function suggestSiblingPath(missingPath, { readdir = readdirSync } = {}) {
  const folder = dirname(missingPath);
  let entries;
  try {
    entries = readdir(folder);
  } catch {
    return null;
  }
  const name = basename(missingPath);
  const stem = basename(name, extname(name)).toLowerCase();
  const servable = entries.filter((entry) => !entry.startsWith(".") && !entry.toLowerCase().endsWith(".comments.md"));
  const sameStem = servable.find((entry) => {
    const lower = entry.toLowerCase();
    return basename(lower, extname(lower)) === stem && /\.(html?|md|markdown)$/.test(lower);
  });
  const match = sameStem || closestMatch(name, servable);
  return match ? join(folder, match) : null;
}

export class UsageError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = "UsageError";
    this.hint = hint;
  }
}

// Errors are one line for the problem, one optional line for the fix, and a
// pointer to help; never a full help dump.
export function formatCliError(error, { style = plainStyle, helpCommand = "tunelito --help" } = {}) {
  const message = error?.message || String(error);
  const lines = [`${style.red("tunelito:")} ${terminalText(message)}`];
  if (error?.hint) lines.push(terminalText(error.hint));
  if (helpCommand) lines.push(`Run \`${terminalText(helpCommand)}\` for usage.`);
  return `${lines.join("\n")}\n`;
}

// Writes lines to a stream while keeping one "sticky" status line (the
// pending tunnel row) at the bottom on a TTY. On a non-TTY every update is
// simply appended, so logs and pipes stay linear.
export function createTerminalWriter({ stream = process.stdout, env = process.env, plain = false, accessible = false, interactive = presentationEnabled({ stream, env, plain, accessible }) } = {}) {
  let sticky = "";

  function clearSticky() {
    if (interactive && sticky) stream.write("\r\u001b[2K");
  }

  function drawSticky() {
    if (interactive && sticky) stream.write(sticky);
  }

  return {
    interactive,
    line(text = "") {
      clearSticky();
      stream.write(`${text}\n`);
      drawSticky();
    },
    status(text) {
      if (!interactive) {
        stream.write(`${text}\n`);
        return;
      }
      clearSticky();
      // A wrapped sticky line cannot be erased with a single-line clear.
      // Append it intact instead of hiding the only copy of a value.
      const columns = stream.columns || 0;
      const plain = stripAnsi(text);
      if (columns && (displayWidth(plain) >= columns || plain.includes("\n"))) {
        sticky = "";
        stream.write(`${text}\n`);
        return;
      }
      sticky = text;
      drawSticky();
    },
    settle(text) {
      clearSticky();
      sticky = "";
      if (text !== undefined) stream.write(`${text}\n`);
    },
  };
}
