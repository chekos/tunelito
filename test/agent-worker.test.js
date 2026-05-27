import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderCommentsMarkdown } from "../src/comments.js";
import {
  DEFAULT_AGENT_TRIGGER,
  commentMatchesTrigger,
  fingerprintComment,
  loadAgentState,
  parseAgentResult,
  prepareAgentQueue,
  runAgentCommand,
  runAgentPass,
} from "../src/agent-worker.js";

test("agent worker runs a custom command once and records resolved comments", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-worker-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const logPath = join(siteDir, ".tunelito", "agent", "log.md");
  const callsPath = join(dir, "calls.txt");
  const scriptPath = join(dir, "fake-agent.mjs");

  writeFileSync(join(siteDir, "about.html"), "<!doctype html><html><body><p>Explain the project here.</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [comment({ id: "c_1", body: "@agent Make this sentence concrete.", pagePath: "/about.html" })],
  }));
  writeFileSync(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const prompt = await new Promise((resolve) => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => resolve(raw));
});
if (!prompt.includes("c_1")) throw new Error("missing comment id");
const calls = process.env.TUNELITO_TEST_CALLS;
writeFileSync(calls, String((existsSync(calls) ? Number(readFileSync(calls, "utf8")) : 0) + 1));
const html = readFileSync("about.html", "utf8").replace("Explain the project here.", "This project helps teams review HTML drafts.");
writeFileSync("about.html", html);
console.log(JSON.stringify({
  comments: [{
    id: "c_1",
    status: "resolved",
    summary: "Made the project description concrete.",
    filesChanged: ["about.html"]
  }]
}));
`);

  process.env.TUNELITO_TEST_CALLS = callsPath;
  try {
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;
    const first = await runAgentPass({
      provider: "custom",
      command,
      commentsPath,
      targetPath: siteDir,
      workspaceRoot: siteDir,
      statePath,
      logPath,
      trigger: DEFAULT_AGENT_TRIGGER,
      maxAttempts: 2,
      log() {},
    });

    assert.equal(first.processed, 1);
    assert.match(readFileSync(join(siteDir, "about.html"), "utf8"), /helps teams review HTML drafts/);
    assert.equal(readFileSync(callsPath, "utf8"), "1");

    const state = loadAgentState(statePath);
    assert.equal(state.comments.c_1.status, "resolved");
    assert.equal(state.comments.c_1.attempts, 1);
    assert.deepEqual(state.comments.c_1.filesChanged, ["about.html"]);
    assert.match(readFileSync(logPath, "utf8"), /c_1: resolved/);

    const second = await runAgentPass({
      provider: "custom",
      command,
      commentsPath,
      targetPath: siteDir,
      workspaceRoot: siteDir,
      statePath,
      logPath,
      trigger: DEFAULT_AGENT_TRIGGER,
      maxAttempts: 2,
      log() {},
    });

    assert.equal(second.processed, 0);
    assert.equal(readFileSync(callsPath, "utf8"), "1");
  } finally {
    delete process.env.TUNELITO_TEST_CALLS;
  }
});

test("agent worker blocks comments when the agent output is not structured JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-invalid-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const logPath = join(siteDir, ".tunelito", "agent", "log.md");
  const callsPath = join(dir, "calls.txt");
  const scriptPath = join(dir, "fake-agent.mjs");

  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [comment({ id: "c_bad", body: "@agent Tighten this.", pagePath: "/" })],
  }));
  writeFileSync(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
process.stdin.resume();
await new Promise((resolve) => process.stdin.on("end", resolve));
const calls = process.env.TUNELITO_TEST_CALLS;
writeFileSync(calls, String((existsSync(calls) ? Number(readFileSync(calls, "utf8")) : 0) + 1));
console.log("done");
`);

  process.env.TUNELITO_TEST_CALLS = callsPath;
  try {
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;
    const first = await runAgentPass({
      provider: "custom",
      command,
      commentsPath,
      targetPath: siteDir,
      workspaceRoot: siteDir,
      statePath,
      logPath,
      trigger: DEFAULT_AGENT_TRIGGER,
      maxAttempts: 2,
      log() {},
    });
    assert.equal(first.processed, 1);
    assert.equal(loadAgentState(statePath).comments.c_bad.status, "blocked");

    const second = await runAgentPass({
      provider: "custom",
      command,
      commentsPath,
      targetPath: siteDir,
      workspaceRoot: siteDir,
      statePath,
      logPath,
      trigger: DEFAULT_AGENT_TRIGGER,
      maxAttempts: 2,
      log() {},
    });
    assert.equal(second.processed, 0);
    assert.equal(readFileSync(callsPath, "utf8"), "1");
  } finally {
    delete process.env.TUNELITO_TEST_CALLS;
  }
});

test("agent queue skips resolved comments and marks changed resolved comments for review", () => {
  const item = comment({ id: "c_done", body: "@agent Edit this." });
  const state = {
    comments: {
      c_done: {
        status: "resolved",
        fingerprint: fingerprintComment(item),
      },
    },
  };

  assert.equal(prepareAgentQueue([item], state, { trigger: DEFAULT_AGENT_TRIGGER }).pending.length, 0);

  const changed = comment({ id: "c_done", body: "@agent Edit this differently." });
  const result = prepareAgentQueue([changed], state, { trigger: DEFAULT_AGENT_TRIGGER });
  assert.equal(result.changed, true);
  assert.equal(result.pending.length, 0);
  assert.equal(state.comments.c_done.status, "changed_needs_review");
});

test("agent trigger defaults to @agent and supports all comments", () => {
  const unmentioned = comment({ id: "c_2", body: "Make this shorter." });
  const mentioned = comment({ id: "c_3", body: "@Agent Make this shorter." });

  assert.equal(commentMatchesTrigger(unmentioned, DEFAULT_AGENT_TRIGGER), false);
  assert.equal(commentMatchesTrigger(mentioned, DEFAULT_AGENT_TRIGGER), true);
  assert.equal(commentMatchesTrigger(unmentioned, "all"), true);
});

test("parseAgentResult accepts direct JSON, Claude JSON wrappers, and legacy buckets", () => {
  assert.deepEqual(parseAgentResult(JSON.stringify({
    comments: [{ id: "c_1", status: "success", summary: "Done", filesChanged: ["index.html"] }],
  })).comments, [{
    id: "c_1",
    status: "resolved",
    summary: "Done",
    filesChanged: ["index.html"],
  }]);

  assert.deepEqual(parseAgentResult(JSON.stringify({
    result: "```json\n{\"comments\":[{\"id\":\"c_2\",\"status\":\"noop\"}]}\n```",
  })).comments[0], {
    id: "c_2",
    status: "no-op",
    summary: "",
    filesChanged: [],
  });

  assert.deepEqual(parseAgentResult(JSON.stringify({
    blocked: [{ id: "c_3", summary: "Missing page" }],
  })).comments[0], {
    id: "c_3",
    status: "blocked",
    summary: "Missing page",
    filesChanged: [],
  });
});

test("codex provider command uses supported non-interactive exec flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-codex-"));
  const calls = [];

  const result = await runAgentCommand({
    provider: "codex",
    workspaceRoot: dir,
    commentsPath: join(dir, "comments.md"),
    statePath: join(dir, ".tunelito", "agent", "state.json"),
    prompt: "test prompt",
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      const child = fakeChild();
      const outputPath = args[args.indexOf("-o") + 1];
      setImmediate(() => {
        writeFileSync(outputPath, JSON.stringify({ comments: [{ id: "c_1", status: "resolved" }] }));
        child.emit("close", 0);
      });
      return child;
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args.slice(0, 6), ["exec", "-C", dir, "--skip-git-repo-check", "-s", "workspace-write"]);
  assert.equal(calls[0].args.includes("-a"), false);
  assert.equal(calls[0].args.at(-1), "-");
});

function comment(overrides = {}) {
  return {
    id: "c_test",
    author: "Jane",
    quote: "Explain the project here.",
    body: "Make this more specific.",
    prefix: "",
    suffix: "",
    path: "body > main > p",
    pagePath: "/about.html",
    textStart: 0,
    textEnd: 25,
    created: "2026-05-27T12:00:00.000Z",
    ...overrides,
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  return child;
}
