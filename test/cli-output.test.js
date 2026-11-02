import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  UsageError,
  closestMatch,
  colorEnabled,
  createStyle,
  createTerminalWriter,
  displayPath,
  formatCliError,
  formatDuration,
  formatEvent,
  formatRows,
  stripAnsi,
  suggestSiblingPath,
} from "../src/cli-output.js";
import {
  formatAgentLogLine,
  formatCommentEvent,
  formatShutdownSummary,
  formatStartup,
  parseArgs,
  unknownOptionError,
} from "../bin/tunelito.js";

const tty = { isTTY: true };

test("color follows TTY, NO_COLOR, FORCE_COLOR, CI, and TERM=dumb", () => {
  assert.equal(colorEnabled({ stream: tty, env: {} }), true);
  assert.equal(colorEnabled({ stream: {}, env: {} }), false);
  assert.equal(colorEnabled({ stream: tty, env: { NO_COLOR: "1" } }), false);
  assert.equal(colorEnabled({ stream: {}, env: { FORCE_COLOR: "1" } }), true);
  assert.equal(colorEnabled({ stream: tty, env: { NO_COLOR: "1", FORCE_COLOR: "1" } }), false);
  assert.equal(colorEnabled({ stream: tty, env: { CI: "true" } }), false);
  assert.equal(colorEnabled({ stream: tty, env: { TERM: "dumb" } }), false);
  assert.equal(createStyle(false).bold("x"), "x");
  assert.equal(stripAnsi(createStyle(true).bold("x")), "x");
});

test("displayPath prefers cwd-relative, then home-relative paths", () => {
  assert.equal(displayPath("/work/site/notes.md", { cwd: "/work", home: "/home/me" }), "site/notes.md");
  assert.equal(displayPath("/home/me/docs/a.md", { cwd: "/work", home: "/home/me" }), "~/docs/a.md");
  assert.equal(displayPath("/srv/a.md", { cwd: "/work", home: "/home/me" }), "/srv/a.md");
  assert.equal(displayPath("/work", { cwd: "/work", home: "/home/me" }), ".");
});

test("formatRows aligns labels to a shared column and honors a minimum width", () => {
  const lines = formatRows([
    { label: "Local", value: "http://x", hint: "you" },
    null,
    { label: "Comments", value: "a.comments.md" },
  ]);
  assert.deepEqual(lines, [
    "  Local      http://x   you",
    "  Comments   a.comments.md",
  ]);
  assert.equal(formatRows([{ label: "Public", value: "u" }], undefined, { labelWidth: 8 })[0], "  Public     u");
});

test("runtime events carry a clock and a fixed-width verb", () => {
  const now = new Date(2026, 10, 2, 9, 5);
  assert.equal(formatEvent("comment", "Ana: hi", { now }), "09:05  comment  Ana: hi");
  assert.equal(formatEvent("viewers", "2 connected", { now }), "09:05  viewers  2 connected");
  assert.equal(formatAgentLogLine("Agent:   processed 2 comments", undefined, now), "09:05  agent    processed 2 comments");
  assert.equal(formatAgentLogLine("line one\nline two"), "line one\nline two");
});

test("comment events prefer the body and mark site scope", () => {
  assert.equal(formatCommentEvent({ author: "Ana", body: "Tighten   the hero", quote: "Hero" }), "Ana: Tighten the hero");
  assert.equal(formatCommentEvent({ author: "Ana", body: "Global note", scope: "site" }), "Ana (site): Global note");
  assert.equal(formatCommentEvent({ author: "Ana", body: "x", pagePath: "/about.html" }, { folder: true }), "Ana (/about.html): x");
  assert.ok(formatCommentEvent({ author: "Ana", body: "a".repeat(200) }).endsWith("…"));
});

test("durations read naturally", () => {
  assert.equal(formatDuration(4_000), "4s");
  assert.equal(formatDuration(42 * 60_000), "42m");
  assert.equal(formatDuration(125 * 60_000), "2h 5m");
});

test("unknown options suggest the closest real flag", () => {
  const error = unknownOptionError("--no-tunel");
  assert.ok(error instanceof UsageError);
  assert.equal(error.hint, "Did you mean --no-tunnel?");
  assert.equal(unknownOptionError("--zzzzzzzz").hint, undefined);
  assert.equal(closestMatch("--epheral", ["--ephemeral", "--editable"]), "--ephemeral");
  assert.throws(() => parseArgs(["page.html", "--opne"]), (thrown) => thrown instanceof UsageError && thrown.hint === "Did you mean --open?");
  assert.throws(() => parseArgs(["a.html", "b.html"]), UsageError);
});

test("CLI errors are short: problem, fix, help pointer", () => {
  const text = formatCliError(new UsageError("Unknown option --x", { hint: "Did you mean --open?" }));
  assert.equal(text, "tunelito: Unknown option --x\nDid you mean --open?\nRun `tunelito --help` for usage.\n");
  assert.equal(formatCliError(new Error("boom"), { helpCommand: "" }), "tunelito: boom\n");
});

test("missing targets suggest a sibling with the same stem or a near name", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-suggest-"));
  writeFileSync(join(dir, "notes.md"), "# Notes\n");
  writeFileSync(join(dir, "notes.comments.md"), "");
  assert.equal(suggestSiblingPath(join(dir, "notes")), join(dir, "notes.md"));
  assert.equal(suggestSiblingPath(join(dir, "ntoes.md")), join(dir, "notes.md"));
  assert.equal(suggestSiblingPath(join(dir, "unrelated-file.html")), null);
  assert.equal(suggestSiblingPath(join(dir, "missing-dir", "x.md")), null);
});

test("startup block leads with links and hides agent plumbing unless asked", () => {
  const base = {
    version: "1.0.0",
    targetPath: join(process.cwd(), "site"),
    isMarkdownTarget: true,
    localUrl: "http://127.0.0.1:4317/?tunelito_key=k",
    commentsPath: join(process.cwd(), "site.comments.md"),
    auth: true,
    theme: { value: "bns-pitaya", source: "default" },
    handoff: "tunelito review watch --url 'u' --json",
    sessionPath: join(process.cwd(), "site", ".tunelito", "session.json"),
  };
  const text = formatStartup(base).join("\n");
  assert.equal(text, [
    "tunelito 1.0.0 · site",
    "Keyed links · Ctrl-C to stop",
    "",
    "  Local      http://127.0.0.1:4317/?tunelito_key=k   you, on this machine",
    "  Comments   site.comments.md",
  ].join("\n"));

  const verbose = formatStartup({ ...base, verbose: true }).join("\n");
  assert.match(verbose, /Theme      bns-pitaya   default/);
  assert.match(verbose, /Handoff    tunelito review watch/);
  assert.match(verbose, /Session    site\/\.tunelito\/session\.json/);

  const open = formatStartup({ ...base, auth: false, ephemeral: true }).join("\n");
  assert.match(open, /Open links \(--no-auth\)/);
  assert.match(open, /Access     anyone with a link can view and comment/);
  assert.match(open, /Comments   in memory only/);

  const themed = formatStartup({ ...base, theme: { value: "editorial", source: "project" } }).join("\n");
  assert.match(themed, /Theme      editorial   from project/);
  const html = formatStartup({ ...base, isMarkdownTarget: false, theme: { value: "editorial", source: "cli" } }).join("\n");
  assert.doesNotMatch(html, /Theme/);
});

test("agent-session startup keeps the rows the attached agent needs", () => {
  const text = formatStartup({
    version: "1.0.0",
    targetPath: "/tmp/site",
    localUrl: "http://l",
    commentsPath: "/tmp/site.comments.md",
    auth: true,
    agentSession: { description: "this session (all comments)", tracker: "tunelito inbox status x", record: "tunelito inbox record x" },
    handoff: "tunelito review watch",
    sessionPath: "/tmp/site/.tunelito/session.json",
  }).join("\n");
  assert.match(text, /Agent      this session/);
  assert.match(text, /Tracker    tunelito inbox status x/);
  assert.match(text, /Record     tunelito inbox record x/);
  assert.match(text, /Handoff    tunelito review watch/);
  assert.match(text, /Session    /);
});

test("shutdown summary reports duration, new comments, and the next step", () => {
  const cwd = process.cwd();
  assert.equal(
    formatShutdownSummary({ elapsedMs: 42 * 60_000, newComments: 3, commentsPath: join(cwd, "a.comments.md"), targetPath: join(cwd, "a.html") }),
    "Stopped after 42m · 3 new comments in a.comments.md\nNext: tunelito inbox status a.html",
  );
  assert.equal(
    formatShutdownSummary({ elapsedMs: 1000, newComments: 0, commentsPath: join(cwd, "a.comments.md"), targetPath: join(cwd, "a.html") }),
    "Stopped after 1s · 0 new comments in a.comments.md",
  );
  assert.equal(formatShutdownSummary({ elapsedMs: 1000, newComments: 1, ephemeral: true }), "Stopped after 1s · 1 comment discarded (in-memory session)");
});

test("terminal writer keeps a sticky status line on a TTY and appends otherwise", () => {
  const chunks = [];
  const stream = { isTTY: true, columns: 80, write: (chunk) => chunks.push(chunk) };
  const out = createTerminalWriter({ stream });
  out.status("  Public   starting…");
  out.line("09:00  viewers  1 connected");
  out.settle("  Public   https://x");
  const screen = chunks.join("");
  assert.equal(screen, "  Public   starting…\r\u001b[2K09:00  viewers  1 connected\n  Public   starting…\r\u001b[2K  Public   https://x\n");

  const piped = [];
  const plain = createTerminalWriter({ stream: { write: (chunk) => piped.push(chunk) } });
  plain.status("  Public   starting…");
  plain.settle("  Public   https://x");
  assert.equal(piped.join(""), "  Public   starting…\n  Public   https://x\n");
});
