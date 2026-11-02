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

export function colorEnabled({ stream = process.stdout, env = process.env } = {}) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false") return true;
  if (!stream?.isTTY) return false;
  if (env.TERM === "dumb") return false;
  if (env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI !== "false") return false;
  return true;
}

export function createStyle(options = {}) {
  const enabled = typeof options === "boolean" ? options : colorEnabled(options);
  const wrap = ([open, close]) => (text) => (enabled ? `${open}${text}${close}` : String(text));
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
export function formatRows(rows, style = plainStyle, { indent = "  ", gap = 3, labelWidth } = {}) {
  const visible = rows.filter(Boolean);
  const width = Math.max(labelWidth || 0, ...visible.map((row) => row.label.length));
  return visible.map((row) => {
    const label = style.dim(row.label.padEnd(width + gap));
    const value = toneValue(row.value, row.tone, style);
    const hint = row.hint ? `   ${style.dim(row.hint)}` : "";
    return `${indent}${label}${value}${hint}`;
  });
}

function toneValue(value, tone, style) {
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
  const coloredVerb = toneValue(verb.padEnd(EVENT_VERB_WIDTH), tone, style);
  return `${style.dim(formatClock(now))}  ${coloredVerb} ${text}`;
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
  return `${count} ${count === 1 ? singular : pluralForm}`;
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
  const lines = [`${style.red("tunelito:")} ${message}`];
  if (error?.hint) lines.push(error.hint);
  if (helpCommand) lines.push(style.dim(`Run \`${helpCommand}\` for usage.`));
  return `${lines.join("\n")}\n`;
}

// Writes lines to a stream while keeping one "sticky" status line (the
// pending tunnel row) at the bottom on a TTY. On a non-TTY every update is
// simply appended, so logs and pipes stay linear.
export function createTerminalWriter({ stream = process.stdout, interactive = Boolean(stream?.isTTY) } = {}) {
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
      // A wrapped sticky line cannot be erased with a single-line clear, so
      // fall back to plain truncated text when it would overflow.
      const columns = stream.columns || 0;
      const plain = stripAnsi(text);
      sticky = columns && plain.length >= columns ? `${plain.slice(0, columns - 2)}…` : text;
      drawSticky();
    },
    settle(text) {
      clearSticky();
      sticky = "";
      if (text !== undefined) stream.write(`${text}\n`);
    },
  };
}
