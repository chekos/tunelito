import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { agentBlockedPaths, generateAccessKey, isCliEntry, loadAgentPromptOptions, openBrowser, parseArgs, VERSION, withReviewKey } from "../bin/tunelito.js";

test("CLI version matches package metadata", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("parseArgs rejects --out without a value", () => {
  assert.throws(() => parseArgs(["page.html", "--out"]), /--out requires a value/);
  assert.throws(() => parseArgs(["page.html", "--out", "--no-tunnel"]), /--out requires a value/);
});

test("parseArgs supports version flag without a file", () => {
  assert.equal(parseArgs(["--version"]).version, true);
  assert.equal(parseArgs(["-v"]).version, true);
});

test("parseArgs enables review-key auth by default and can disable it", () => {
  assert.equal(parseArgs(["page.html"]).auth, true);
  assert.equal(parseArgs(["page.html", "--no-auth"]).auth, false);
});

test("parseArgs supports ephemeral live mode", () => {
  const opts = parseArgs(["page.html", "--live"]);
  assert.equal(opts.live, true);
  assert.equal(opts.filePath, resolve("page.html"));
});

test("parseArgs supports local agent worker options", () => {
  const opts = parseArgs([
    "site",
    "--agent",
    "codex",
    "--agent-interval",
    "30",
    "--agent-policy",
    "owner-or-mention",
    "--agent-trigger",
    "@agent",
    "--agent-instructions",
    "Use short copy.",
    "--agent-max-attempts",
    "3",
    "--agent-max-passes",
    "5",
    "--agent-state",
    "agent-state.json",
  ]);

  assert.equal(opts.agent, "codex");
  assert.equal(opts.agentIntervalSeconds, 30);
  assert.equal(opts.agentPolicy, "owner-or-mention");
  assert.equal(opts.agentTrigger, "@agent");
  assert.equal(opts.agentInstructions, "Use short copy.");
  assert.equal(opts.agentMaxAttempts, 3);
  assert.equal(opts.agentMaxPasses, 5);
  assert.equal(opts.agentStatePath, resolve("agent-state.json"));
});

test("parseArgs rejects invalid agent max passes values", () => {
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-max-passes", "0"]), /Invalid --agent-max-passes/);
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-max-passes", "x"]), /Invalid --agent-max-passes/);
});

test("parseArgs validates agent policy options", () => {
  assert.equal(parseArgs(["site", "--agent", "codex", "--agent-policy", "owner"]).agentPolicy, "owner");
  assert.throws(() => parseArgs(["site", "--agent-policy", "owner"]), /--agent-policy requires --agent/);
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-policy", "visitor"]), /Unsupported --agent-policy/);
  assert.throws(
    () => parseArgs(["site", "--agent", "codex", "--agent-policy", "mention"]),
    /requires --agent-trigger/,
  );
  assert.doesNotThrow(() => parseArgs(["site", "--agent", "codex", "--agent-policy", "mention", "--agent-trigger", "@agent"]));
});

test("parseArgs rejects partial numeric option values", () => {
  assert.throws(() => parseArgs(["page.html", "--port", "4317junk"]), /Invalid --port value/);
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-interval", "30s"]), /Invalid --agent-interval value/);
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-max-attempts", "2.5"]), /Invalid --agent-max-attempts value/);
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-max-passes", "2.5"]), /Invalid --agent-max-passes value/);
});

test("parseArgs rejects option-looking host values", () => {
  assert.throws(() => parseArgs(["page.html", "--host", "--no-tunnel"]), /--host requires a value/);
});

test("parseArgs and loadAgentPromptOptions support prompt files", () => {
  const dir = mkdtempSync(`${tmpdir()}/tunelito-agent-prompt-`);
  const instructionsPath = resolve(dir, "instructions.md");
  const promptPath = resolve(dir, "prompt.md");
  writeFileSync(instructionsPath, "Prefer one-sentence edits.");
  writeFileSync(promptPath, "You are a launch-page editor.");

  const opts = parseArgs([
    "site",
    "--agent",
    "codex",
    "--agent-instructions-file",
    instructionsPath,
    "--agent-prompt-file",
    promptPath,
  ]);

  assert.equal(opts.agentInstructionsPath, instructionsPath);
  assert.equal(opts.agentPromptPath, promptPath);
  assert.deepEqual(loadAgentPromptOptions(opts), {
    append: "Prefer one-sentence edits.",
    override: "You are a launch-page editor.",
  });
});

test("parseArgs supports custom agent commands", () => {
  const opts = parseArgs(["site", "--agent-command", "openclaw run --stdin"]);
  assert.equal(opts.agent, "custom");
  assert.equal(opts.agentCommand, "openclaw run --stdin");
});

test("agentBlockedPaths includes the derived local agent log", () => {
  const statePath = resolve("agent-state.json");
  assert.deepEqual(agentBlockedPaths(statePath), [
    statePath,
    `${statePath}.tmp`,
    resolve("log.md"),
  ]);
});

test("parseArgs rejects agent mode with live comments", () => {
  assert.throws(() => parseArgs(["site", "--live", "--agent", "codex"]), /--agent requires persistent comments/);
});

test("parseArgs rejects prompt options without an agent", () => {
  assert.throws(
    () => parseArgs(["site", "--agent-instructions", "Use short copy."]),
    /--agent prompt options require --agent/,
  );
});

test("parseArgs rejects conflicting prompt option sources", () => {
  assert.throws(
    () => parseArgs(["site", "--agent", "codex", "--agent-instructions", "A", "--agent-instructions-file", "instructions.md"]),
    /Use either --agent-instructions or --agent-instructions-file/,
  );
  assert.throws(
    () => parseArgs(["site", "--agent", "codex", "--agent-prompt", "A", "--agent-prompt-file", "prompt.md"]),
    /Use either --agent-prompt or --agent-prompt-file/,
  );
});

test("parseArgs rejects custom commands for preset providers", () => {
  assert.throws(
    () => parseArgs(["site", "--agent-command", "openclaw run --stdin", "--agent", "codex"]),
    /--agent-command can only be used with --agent custom/,
  );
});

test("parseArgs rejects unsupported agent providers", () => {
  assert.throws(() => parseArgs(["site", "--agent", "openclaw"]), /Unsupported --agent provider/);
});

test("isCliEntry recognizes npm-style symlinked bin paths", () => {
  const dir = mkdtempSync(`${tmpdir()}/tunelito-bin-`);
  const target = `${dir}/tunelito.js`;
  const link = `${dir}/tunelito`;
  writeFileSync(target, "#!/usr/bin/env node\n");
  symlinkSync(target, link);

  assert.equal(isCliEntry(pathToFileURL(realpathSync(target)).href, link), true);
});

test("parseArgs accepts an explicit comments path", () => {
  const opts = parseArgs(["page.html", "--out", "notes.md", "--no-tunnel"]);
  assert.equal(opts.filePath, resolve("page.html"));
  assert.equal(opts.commentsPath, resolve("notes.md"));
  assert.equal(opts.tunnel, false);
});

test("parseArgs accepts an owner name", () => {
  const opts = parseArgs(["page.html", "--owner", "  Chekos  "]);
  assert.equal(opts.ownerName, "Chekos");
});

test("parseArgs rejects missing owner names", () => {
  assert.throws(() => parseArgs(["page.html", "--owner"]), /--owner requires a name/);
  assert.throws(() => parseArgs(["page.html", "--owner", "--no-tunnel"]), /--owner requires a name/);
  assert.throws(() => parseArgs(["page.html", "--owner", "   "]), /--owner requires a name/);
});

test("generateAccessKey creates URL-safe entropy for shared links", () => {
  const key = generateAccessKey(() => Buffer.from("abcdefghijklmnopqr"));
  assert.equal(key, "YWJjZGVmZ2hpamtsbW5vcHFy");
});

test("withReviewKey appends the review key without dropping existing query params", () => {
  assert.equal(
    withReviewKey("https://example.test/review?x=1", "secret"),
    "https://example.test/review?x=1&tunelito_key=secret",
  );
});

test("withReviewKey leaves unkeyed URLs alone", () => {
  assert.equal(withReviewKey("https://example.test/review", null), "https://example.test/review");
});

test("openBrowser uses a platform opener and logs spawn errors", () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const calls = [];
  const logs = [];

  const returned = openBrowser("http://127.0.0.1:4317/", {
    platform: "linux",
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
    log(message) {
      logs.push(message);
    },
  });

  assert.equal(returned, child);
  assert.deepEqual(calls, [{
    command: "xdg-open",
    args: ["http://127.0.0.1:4317/"],
    options: { stdio: "ignore", detached: true },
  }]);

  child.emit("error", new Error("not found"));
  assert.deepEqual(logs, ["Open:    could not launch browser (not found)"]);
});

test("openBrowser uses Windows start command on win32", () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const calls = [];

  openBrowser("http://127.0.0.1:4317/", {
    platform: "win32",
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
    log() {},
  });

  assert.equal(calls[0].command, "cmd");
  assert.deepEqual(calls[0].args, ["/c", "start", "", "http://127.0.0.1:4317/"]);
});
