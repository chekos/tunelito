import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { commandMetadata, createHumanReporter, createJsonReporter, formatCommentEvent, parseArgs,
  parseCommentsArgs, parseDoctorArgs, parseInboxArgs, parseReviewArgs, VERSION } from "../bin/tunelito.js";
import { normalizeComment } from "../src/comments.js";
import { colorEnabled, createStyle, createTerminalWriter, formatRows, presentationEnabled, stripAnsi, terminalText } from "../src/cli-output.js";

const bin = resolve("bin/tunelito.js");
const cleanEnv = { ...process.env };
for (const name of ["NO_COLOR", "FORCE_COLOR", "CI", "TERM", "TUNELITO_PLAIN", "TUNELITO_DEBUG"]) delete cleanEnv[name];
function cli(args, { env = {}, tty = false } = {}) {
  // Exercise the real entry point with independent stdout/stderr, including
  // the isTTY capabilities a PTY exposes without merging its two streams.
  const launch = tty ? ["--input-type=module", "-e", `process.stdout.isTTY=${typeof tty === "object" ? tty.stdout : true};process.stderr.isTTY=${typeof tty === "object" ? tty.stderr : true};process.argv=[process.execPath,${JSON.stringify(bin)},...process.argv.slice(1)];await import(${JSON.stringify(bin)});`, "--", ...args] : [bin, ...args];
  return spawnSync(process.execPath, launch, { encoding: "utf8", env: { ...cleanEnv, ...env }, timeout: 5000 });
}
function collect(extra = {}) {
  let text = "";
  return { ...extra, write(chunk) { text += chunk; return true; }, text: () => text };
}

test("terminal controls are visible through normalization, formatting and human reporting; JSON stays raw", () => {
  const comment = normalizeComment({ id: "c_attack", author: "José\x1b[2J\t\u202e", body: "Hola 🌮\x1b]52;c;payload\x07\x9b31m\u200b\r\nend", pagePath: "/a\x1b[31m" });
  assert.ok(comment.author.includes("\x1b"));
  assert.ok(comment.body.includes("\x1b"));
  const rendered = formatCommentEvent(comment, { folder: true });
  assert.doesNotMatch(rendered, /[\p{Cc}\p{Cf}]/u);
  assert.match(rendered, /José\\x1b\[2J\\t\\u\{202e\}/);
  for (const rich of [false, true]) {
    const stream = collect();
    const reporter = createHumanReporter({ stream, style: createStyle(rich), env: {} });
    reporter.comment(comment);
    reporter.warning("bad\x1b[2J\nforged");
    reporter.agentLog("prompt\nreviewer\x1b]8;;https://evil\x07link\u2066");
    reporter.tunnel("unavailable", { error: "bad\x1b[2J" });
    assert.doesNotMatch(stripAnsi(stream.text()), /[\x00-\x09\x0b-\x1f\x7f-\x9f\p{Cf}]/u);
    assert.match(stream.text(), /Hola 🌮/);
  }
  const json = collect();
  createJsonReporter({ stream: json }).comment(comment);
  assert.equal(JSON.parse(json.text()).body, comment.body);
  assert.equal(JSON.parse(json.text()).author, comment.author);
  assert.equal(terminalText("a\n\tb\x00\x7f\u200d"), "a\\n\\tb\\x00\\x7f\\u{200d}");
});

test("machine parse failures use one stable stderr error at root and nested depths, in either order", () => {
  for (const args of [
    ["--json", "--bogus"], ["--bogus", "--json"],
    ["doctor", "--bogus", "--json"], ["--json", "doctor", "--bogus"],
    ["inbox", "record", "--json"], ["comments", "inspect", "--json"],
    ["review", "watch", "--timeout=bad", "--json"],
    ["config", "show", "--bogus", "--format=json"],
    ["--format", "json", "inbox", "record"],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 2, JSON.stringify({ args, ...result }));
    assert.equal(result.stdout, "");
    const error = JSON.parse(result.stderr);
    assert.equal(error.format, "tunelito-error");
    assert.equal(error.schemaVersion, 2);
    assert.equal(error.code, "USAGE_ERROR");
    assert.equal(error.exitCode, 2);
    assert.ok(error.message);
    assert.ok(Array.isArray(error.recovery));
    assert.doesNotMatch(result.stderr, /\x1b/);
  }
});

test("machine validation and runtime failures keep streams independent, also on a TTY", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-errors-"));
  try {
    const target = join(dir, "page.html");
    writeFileSync(target, "<!doctype html><p>Hi</p>");
    writeFileSync(join(dir, "tunelito.config.json"), "{bad json");
    for (const tty of [false, true]) {
      for (const args of [["--json", target, "--no-tunnel"], ["config", "show", target, "--json"], ["review", "watch", "--json"]]) {
        const result = cli(args, { tty, env: { FORCE_COLOR: "1", TUNELITO_DEBUG: "1" } });
        assert.equal(result.status, 1, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(JSON.parse(result.stderr).code, "RUNTIME_ERROR");
      }
    }
    const missing = cli(["not-a-real-page-for-cli-test.html", "--json"]);
    assert.equal(missing.status, 2);
    assert.equal(missing.stdout, "");
    assert.match(JSON.parse(missing.stderr).message, /No such file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("untrusted paths are escaped in human errors while JSON errors retain their value", () => {
  const path = "missing-\x1b[2J-\u202e-\t-file.html";
  const human = cli([path], { env: { FORCE_COLOR: "0" } });
  assert.equal(human.status, 2);
  assert.equal(human.stdout, "");
  assert.doesNotMatch(human.stderr, /\x1b|\u202e|\t/);
  assert.match(human.stderr, /\\x1b\[2J/);
  const json = cli([path, "--json"]);
  assert.equal(json.status, 2);
  assert.ok(JSON.parse(json.stderr).message.includes(path));
});

test("global discovery wins before ordinary validation and has consistent machine help", () => {
  for (const path of [[], ["doctor"], ["comments", "inspect"], ["inbox", "record"], ["review", "watch"], ["session", "status"], ["config", "show"], ["skill", "install"], ["mcp"]]) {
    const before = cli(["--json", "help", ...path]);
    const after = cli([...path, "--help", "--json", "--bogus", "--port"]);
    assert.equal(before.status, 0, before.stderr);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(before.stderr, "");
    assert.equal(after.stderr, "");
    assert.deepEqual(JSON.parse(before.stdout), JSON.parse(after.stdout));
    const metadata = JSON.parse(before.stdout);
    assert.ok(metadata.options.some((option) => option.name === "--no-color"));
    for (const args of [["--version", ...path], [...path, "--version"]]) {
      const version = cli(args);
      assert.equal(version.status, 0, version.stderr);
      assert.equal(version.stdout, `${VERSION}\n`);
      assert.equal(version.stderr, "");
    }
  }
  const help = cli(["--no-color", "--help", "--port"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:/);
});

test("shared lexer accepts equals and literal paths, rejects repeats/conflicts, and parses help examples", () => {
  assert.equal(parseArgs(["--port=4318", "--", "--help"]).filePath, resolve("--help"));
  assert.equal(parseArgs(["--port=4318", "--", "--help"]).port, 4318);
  assert.equal(parseDoctorArgs(["--host=localhost", "--", "--json"]).targetPath, resolve("--json"));
  assert.equal(parseCommentsArgs(["inspect", "--", "--help"]).targetPath, resolve("--help"));
  assert.equal(parseInboxArgs(["next", "--limit=2", "--", "--json"]).filePath, resolve("--json"));
  assert.equal(parseReviewArgs(["watch", "--url=http://localhost", "--timeout=2"]).timeoutSeconds, 2);
  assert.equal(parseArgs(["page.html", "--owner=--json"]).ownerName, "--json");
  assert.equal(parseArgs(["page.html", "--agent-session", "--agent-instructions=--help"]).help, undefined);
  assert.equal(parseArgs(["page.html", "--agent-session", "--agent-instructions=--help"]).agentInstructions, "--help");
  assert.equal(parseInboxArgs(["--claim-owner", "next", "next", "page.html"]).claimOwner, "next");
  assert.equal(parseInboxArgs(["--claim-owner", "next", "next", "page.html"]).command, "next");
  for (const args of [["--port=1", "--port=2"], ["--json", "--json"], ["--code-wrap", "--no-code-wrap"], ["--json", "--format=text"], ["--open=true"]]) assert.throws(() => parseArgs(["p.html", ...args]));
  const literal = cli(["--", "--help"]);
  assert.equal(literal.status, 2);
  assert.equal(literal.stdout, "");
  assert.match(literal.stderr, /No such file/);
  for (const example of commandMetadata().examples.filter((example) => /tunelito \.\//.test(example))) {
    assert.doesNotThrow(() => parseArgs(example.split(/\s+/).slice(1)), example);
  }
});

test("format flags route consistently before nested commands and do not change help into prose", () => {
  for (const args of [["--format=json", "skill", "show"], ["--json", "skill", "show"],
    ["--format=json", "skill", "install", "--agent=codex", "--scope=project", "--dry-run"]]) {
    const result = cli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).format, "tunelito-skill");
  }
  for (const name of ["inbox", "comments", "review", "session", "skill", "config"]) {
    const result = cli(["--json", name]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).format, "tunelito-help");
    assert.equal(result.stderr, "");
  }
  assert.equal(commandMetadata("serve").options.find((option) => option.name === "--link-preview-header").arity, 1);
  assert.equal(commandMetadata("serve").options.find((option) => option.name === "--agent-trigger").arity, 1);
  assert.equal(commandMetadata("serve").options.find((option) => option.name === "--link-preview").arity, 2);
  assert.match(commandMetadata("serve").options.find((option) => option.name === "--agent").syntax, /^--agent </);
  assert.ok(commandMetadata("inbox record").options.some((option) => option.name === "--id"));
  assert.ok(!commandMetadata("inbox next").options.some((option) => option.name === "--id"));
});

test("color and redraw capabilities are independent, labels readable and values intact at 40/80/120 columns", () => {
  const tty = { isTTY: true };
  for (const env of [{ FORCE_COLOR: "0" }, { FORCE_COLOR: "false" }, { FORCE_COLOR: "1", NO_COLOR: "1" }]) assert.equal(colorEnabled({ stream: tty, env }), false);
  assert.equal(colorEnabled({ stream: tty, env: { FORCE_COLOR: "1" }, noColor: true }), false);
  assert.equal(colorEnabled({ stream: {}, env: { FORCE_COLOR: "1" } }), true);
  for (const options of [{ env: { CI: "1" } }, { env: { TERM: "dumb" } }, { env: {}, plain: true }, { env: {}, accessible: true }]) {
    assert.equal(presentationEnabled({ stream: tty, ...options }), false);
    const stream = collect(tty);
    const writer = createTerminalWriter({ stream, ...options });
    writer.status("pending"); writer.line("event"); writer.settle("ready");
    assert.doesNotMatch(stream.text(), /\x1b|\r/);
  }
  const path = `https://example.test/${"José-東京-🌮/".repeat(10)}`;
  for (const columns of [40, 80, 120]) {
    const text = formatRows([{ label: "Public", value: path, hint: "share this" }, { label: "Recovery", value: "tunelito doctor ./東京.html --no-tunnel" }], createStyle(true), { columns }).join("\n");
    assert.ok(text.includes(path));
    assert.match(text, /tunelito doctor \.\/東京.html --no-tunnel/);
    assert.doesNotMatch(text, /\x1b\[2m/);
  }
  for (const env of [{ FORCE_COLOR: "0" }, { FORCE_COLOR: "1", NO_COLOR: "1" }, { FORCE_COLOR: "1" }]) {
    const result = cli(["config", "show", "--no-color"], { tty: true, env });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /\x1b/);
  }
  const rich = cli(["config", "show"], { tty: { stdout: true, stderr: false } });
  const plain = cli(["config", "show"], { tty: { stdout: false, stderr: true } });
  assert.match(rich.stdout, /\x1b\[/);
  assert.doesNotMatch(plain.stdout, /\x1b/);
  const errRich = cli(["--bogus"], { tty: { stdout: false, stderr: true } });
  const errPlain = cli(["--bogus"], { tty: { stdout: true, stderr: false } });
  assert.match(errRich.stderr, /\x1b\[/);
  assert.doesNotMatch(errPlain.stderr, /\x1b/);
});

test("real PTY rich/plain transcripts start with inherited color variables cleared", { skip: process.platform !== "linux" && "macOS script requires a controlling input TTY; verify with the host PTY" }, () => {
  const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
  for (const flags of [[], ["--plain"], ["--no-color"]]) {
    const command = [process.execPath, bin, "config", "show", ...flags];
    const args = process.platform === "darwin" ? ["-q", "/dev/null", ...command] : ["-q", "-c", command.map(quote).join(" "), "/dev/null"];
    const result = spawnSync("script", args, { input: "", encoding: "utf8", env: { ...cleanEnv, TERM: "xterm-256color" }, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(stripAnsi(result.stdout), /tunelito config/);
    if (flags.length) assert.doesNotMatch(result.stdout, /\x1b\[/);
    else assert.match(result.stdout, /\x1b\[/);
  }
});

async function serve(t, args) {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-signal-"));
  const target = join(dir, "page.html");
  writeFileSync(target, "<!doctype html><p>Hi</p>");
  const child = spawn(process.execPath, [bin, target, "--no-tunnel", "--port=0", ...args], { env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = once(child, "close");
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) { child.kill("SIGKILL"); await closed; }
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolveStarted, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${stderr}`)), 4000);
    const check = () => { if (/"type":"tunnel"|only this machine can open/.test(stdout + stderr)) { clearTimeout(timer); resolveStarted(); } };
    child.stdout.on("data", check); child.stderr.on("data", check);
    closed.then(() => { clearTimeout(timer); reject(new Error(`exited before startup: ${stderr}`)); });
  });
  return { child, closed, stdout: () => stdout, stderr: () => stderr };
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  test(`real local serve drains stopped JSONL and exits ${exitCode} on ${signal}`, { timeout: 10000 }, async (t) => {
    const run = await serve(t, ["--json", "--ephemeral"]);
    run.child.kill(signal);
    assert.deepEqual(await run.closed, [exitCode, null]);
    const events = run.stdout().trim().split("\n").map(JSON.parse);
    assert.equal(events[0].type, "started");
    assert.ok(events.every((event) => event.time));
    assert.equal(events.at(-1).type, "stopped");
    assert.equal(events.at(-1).signal, signal);
    assert.equal(events.at(-1).exitCode, exitCode);
    assert.equal(events.at(-1).cleanup, "complete");
    assert.equal(JSON.parse(run.stderr()).code, "CANCELLED");
  });
}

test("resolver startup warnings stay typed JSONL after started, with no stray stderr prose", { timeout: 10000 }, async (t) => {
  const run = await serve(t, ["--json", "--link-preview", "^https://tracker.example/(.*)$", "http://127.0.0.1:9/$1",
    "--link-preview-header", "Authorization: Bearer ${env:TUNELITO_TEST_UNSET_RESOLVER_TOKEN}",
    "--link-preview-env", "TUNELITO_TEST_UNSET_RESOLVER_TOKEN"]);
  assert.equal(run.stderr(), "");
  const before = run.stdout().trim().split("\n").map(JSON.parse);
  assert.equal(before[0].type, "started");
  assert.ok(before.some((event) => event.type === "warning" && event.message.includes("TUNELITO_TEST_UNSET_RESOLVER_TOKEN")));
  run.child.kill("SIGTERM");
  assert.deepEqual(await run.closed, [143, null]);
  assert.equal(JSON.parse(run.stderr()).code, "CANCELLED");
});

test("human serve owns stderr; shutdown prints the retained/discarded summary", { timeout: 10000 }, async (t) => {
  const run = await serve(t, ["--plain", "--ephemeral"]);
  run.child.kill("SIGINT");
  assert.deepEqual(await run.closed, [130, null]);
  assert.equal(run.stdout(), "");
  assert.match(run.stderr(), /Local\s+http/);
  assert.match(run.stderr(), /0 comments discarded/);
  assert.doesNotMatch(run.stderr(), /\x1b/);
});
