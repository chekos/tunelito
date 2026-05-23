import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateAccessKey, isCliEntry, openBrowser, parseArgs, VERSION, withReviewKey } from "../bin/tunelito.js";

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
