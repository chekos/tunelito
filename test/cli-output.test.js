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
  createHumanReporter,
  createJsonReporter,
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
  assert.throws(() => parseArgs(["-x"]), UsageError);
  assert.match(parseArgs(["-draft.html"]).filePath, /-draft\.html$/, "longer single-dash words stay paths");
});

test("usage errors never echo flag values or extra positionals", () => {
  const secret = "Bearer s3cr3t-value";
  assert.throws(
    () => parseArgs(["page.html", "Authorization:", secret]),
    (error) => error instanceof UsageError && !`${error.message}\n${error.hint}`.includes("s3cr3t"),
  );
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

function collect() {
  const chunks = [];
  return { write: (chunk) => chunks.push(chunk), text: () => chunks.join(""), isTTY: false };
}

const startupModel = {
  version: "1.0.0",
  targetPath: "/work/site",
  localUrl: "http://127.0.0.1:4317/?tunelito_key=k",
  commentsPath: "/work/site.comments.md",
  sessionPath: "/work/site/.tunelito/session.json",
  auth: true,
  tunnel: true,
  theme: { value: "bns-pitaya", source: "default", details: { description: "long" } },
  handoff: "tunelito review watch --url 'u' --json",
  agentMode: "session",
  agentSession: { description: "this session", tracker: "tunelito inbox status x", record: "tunelito inbox record x" },
};

test("JSON reporter emits one typed, timestamped object per line", () => {
  const stream = collect();
  const at = new Date("2026-11-02T10:00:00.000Z");
  const reporter = createJsonReporter({ stream, now: () => at });
  reporter.startup(startupModel);
  reporter.tunnel("starting");
  reporter.tunnel("dns-wait", { hostname: "a.trycloudflare.com", code: "ENOTFOUND" });
  reporter.tunnel("ready", { publicUrl: "https://a.trycloudflare.com/?tunelito_key=k" });
  reporter.viewers(2);
  reporter.comment({ id: "c_1", author: "Ana", authorRole: "visitor", scope: "page", pagePath: "/", body: "Tighten", quote: "q", prefix: "p" });
  reporter.reload();
  reporter.review({ sequence: 1, summary: { comments: 3 } });
  reporter.agentLog("Agent:   processed 1 comment");
  reporter.agentLog("\nAgent inbox: claimed c_1\nprompt body");
  reporter.stopped({ elapsedMs: 1000, newComments: 1 });

  const events = stream.text().trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["started", "tunnel", "tunnel", "tunnel", "viewers", "comment", "reload", "review", "agent", "prompt", "stopped"]);
  assert.ok(events.every((event) => event.time === "2026-11-02T10:00:00.000Z"));
  const [started] = events;
  assert.equal(started.localUrl, startupModel.localUrl);
  assert.deepEqual(started.theme, { value: "bns-pitaya", source: "default" });
  assert.equal(started.agent, "session");
  assert.equal(started.commands.record, "tunelito inbox record x");
  assert.equal(events[3].state, "ready");
  assert.equal(events[3].publicUrl, "https://a.trycloudflare.com/?tunelito_key=k");
  assert.deepEqual(Object.keys(events[5]).sort(), ["author", "authorRole", "body", "id", "pagePath", "scope", "time", "type"]);
  assert.equal(events[8].message, "processed 1 comment");
  assert.match(events[9].text, /prompt body/);
  assert.equal(createJsonReporter({ stream: collect() }) !== null, true);
});

test("muted reporters drop shutdown noise so stopped is the last event", () => {
  const stream = collect();
  const reporter = createJsonReporter({ stream });
  reporter.viewers(1);
  reporter.mute();
  reporter.viewers(0);
  reporter.agentLog("Agent:   stopping");
  reporter.stopped({ elapsedMs: 5, newComments: 0 });
  reporter.viewers(0);
  const types = stream.text().trim().split("\n").map((line) => JSON.parse(line).type);
  assert.deepEqual(types, ["viewers", "stopped"]);

  const human = collect();
  const humanReporter = createHumanReporter({ stream: human });
  humanReporter.mute();
  humanReporter.viewers(0);
  humanReporter.stopped({ elapsedMs: 1000, newComments: 0, commentsPath: join(process.cwd(), "a.comments.md"), targetPath: join(process.cwd(), "a.html") });
  assert.equal(human.text(), "Stopped after 1s · 0 new comments in a.comments.md\n");
});

test("--flag=value explains the space-separated form", () => {
  assert.throws(
    () => parseArgs(["page.html", "--comments=x.md"]),
    (error) => error.message === '--comments takes its value after a space, not "="' && error.hint === "Use --comments <value>.",
  );
});

test("JSON started event hides the comments path for ephemeral rooms", () => {
  const stream = collect();
  createJsonReporter({ stream }).startup({ ...startupModel, ephemeral: true });
  assert.equal(JSON.parse(stream.text()).commentsPath, null);
});

test("human reporter renders the same events as terminal lines", () => {
  const stream = collect();
  const reporter = createHumanReporter({ stream, now: () => new Date(2026, 10, 2, 9, 5) });
  reporter.startup({ ...startupModel, agentSession: null, agentMode: null });
  reporter.tunnel("starting");
  reporter.tunnel("ready", { publicUrl: "https://a.trycloudflare.com/?tunelito_key=k" });
  reporter.comment({ author: "Ana", body: "Tighten" });
  reporter.warning("could not update metadata (EACCES)");
  reporter.stopped({ elapsedMs: 60_000, newComments: 1, commentsPath: join(process.cwd(), "site.comments.md"), targetPath: join(process.cwd(), "site") });
  const text = stream.text();
  assert.match(text, /^ {2}Public {5}starting Cloudflare Tunnel…$/m, "piped output appends progress");
  assert.match(text, /^ {2}Public {5}https:\/\/a\.trycloudflare\.com\/\?tunelito_key=k {3}share this$/m);
  assert.match(text, /^09:05 {2}comment {2}Ana: Tighten$/m);
  assert.match(text, /^09:05 {2}warning {2}could not update metadata \(EACCES\)$/m);
  assert.match(text, /^Stopped after 1m · 1 new comment in site\.comments\.md$/m);
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
