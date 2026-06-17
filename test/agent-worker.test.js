import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderCommentsMarkdown } from "../src/comments.js";
import {
  DEFAULT_AGENT_MAX_PASSES,
  DEFAULT_AGENT_POLICY,
  DEFAULT_AGENT_TRIGGER,
  buildAgentPrompt,
  claimNextAgentComments,
  commentMatchesAgentPolicy,
  commentMatchesTrigger,
  createAgentSessionWatcher,
  createAgentWorker,
  defaultAgentBehaviorPrompt,
  fingerprintComment,
  formatAgentTodoTracker,
  isWatchedCommentsFilename,
  loadAgentState,
  normalizeAgentConfig,
  normalizeAgentInboxConfig,
  parseAgentResult,
  prepareAgentQueue,
  recordAgentSessionResult,
  runAgentCommand,
  runAgentPass,
  waitForAgentInboxComments,
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
    comments: [comment({ id: "c_1", body: "Make this sentence concrete.", pagePath: "/about.html" })],
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

test("agent worker continues an inline page comment across multiple passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-followup-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const logPath = join(siteDir, ".tunelito", "agent", "log.md");
  const callsPath = join(dir, "calls.txt");
  const scriptPath = join(dir, "fake-agent.mjs");

  writeFileSync(join(siteDir, "day-03.html"), "<!doctype html><html><body><main><p>Old lunch copy.</p><p>Old transit copy.</p></main></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [comment({
      id: "c_multi",
      scope: "page",
      quote: "Old lunch copy.",
      body: "Rewrite the lunch section and then tighten the transit section too.",
      pagePath: "/day-03.html",
    })],
  }));
  writeFileSync(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const prompt = await new Promise((resolve) => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => resolve(raw));
});
const calls = process.env.TUNELITO_TEST_CALLS;
const next = (existsSync(calls) ? Number(readFileSync(calls, "utf8")) : 0) + 1;
writeFileSync(calls, String(next));
let html = readFileSync("day-03.html", "utf8");
if (next === 1) {
  html = html.replace("Old lunch copy.", "Lunch at a reserved neighborhood counter.");
  writeFileSync("day-03.html", html);
  console.log(JSON.stringify({
    comments: [{
      id: "c_multi",
      status: "needs_followup",
      summary: "Updated the lunch copy and left transit for the next pass.",
      filesChanged: ["day-03.html"],
      completedTasks: ["Rewrite the lunch section"],
      remainingTasks: ["Tighten the transit section"]
    }]
  }));
} else {
  if (!prompt.includes("Tighten the transit section")) throw new Error("missing continuation task");
  if (!prompt.includes("Updated the lunch copy")) throw new Error("missing previous summary");
  html = html.replace("Old transit copy.", "Transit notes are short, direct, and timed for mobile use.");
  writeFileSync("day-03.html", html);
  console.log(JSON.stringify({
    comments: [{
      id: "c_multi",
      status: "resolved",
      summary: "Finished lunch and transit updates.",
      filesChanged: ["day-03.html"],
      completedTasks: ["Rewrite the lunch section", "Tighten the transit section"],
      remainingTasks: []
    }]
  }));
}
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
      maxPasses: 4,
      log() {},
    });

    assert.equal(first.processed, 1);
    assert.equal(first.statuses.c_multi, "needs_followup");
    assert.equal(loadAgentState(statePath).comments.c_multi.status, "needs_followup");
    assert.equal(loadAgentState(statePath).comments.c_multi.passes, 1);

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
      maxPasses: 4,
      log() {},
    });

    assert.equal(second.processed, 1);
    assert.equal(second.statuses.c_multi, "resolved");
    assert.equal(readFileSync(callsPath, "utf8"), "2");
    const state = loadAgentState(statePath);
    assert.equal(state.comments.c_multi.status, "resolved");
    assert.equal(state.comments.c_multi.attempts, 2);
    assert.equal(state.comments.c_multi.passes, 2);
    assert.deepEqual(state.comments.c_multi.completedTasks, ["Rewrite the lunch section", "Tighten the transit section"]);
    assert.deepEqual(state.comments.c_multi.remainingTasks, []);
    assert.match(readFileSync(join(siteDir, "day-03.html"), "utf8"), /reserved neighborhood counter/);
    assert.match(readFileSync(join(siteDir, "day-03.html"), "utf8"), /Transit notes are short/);
  } finally {
    delete process.env.TUNELITO_TEST_CALLS;
  }
});

test("agent worker converts follow-up requests to partial at the pass limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-max-passes-"));
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
    comments: [comment({ id: "c_limit", body: "Redesign this page in several stages.", pagePath: "/" })],
  }));
  writeFileSync(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
process.stdin.resume();
await new Promise((resolve) => process.stdin.on("end", resolve));
const calls = process.env.TUNELITO_TEST_CALLS;
writeFileSync(calls, String((existsSync(calls) ? Number(readFileSync(calls, "utf8")) : 0) + 1));
console.log(JSON.stringify({
  comments: [{
    id: "c_limit",
    status: "needs_followup",
    summary: "Completed one slice but more remains.",
    filesChanged: ["index.html"],
    completedTasks: ["Fix page spacing"],
    remainingTasks: ["Restyle cards"]
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
      maxPasses: 1,
      log() {},
    });
    assert.equal(first.statuses.c_limit, "partial");
    assert.equal(loadAgentState(statePath).comments.c_limit.status, "partial");
    assert.deepEqual(loadAgentState(statePath).comments.c_limit.remainingTasks, ["Restyle cards"]);

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
      maxPasses: 1,
      log() {},
    });
    assert.equal(second.processed, 0);
    assert.equal(readFileSync(callsPath, "utf8"), "1");
  } finally {
    delete process.env.TUNELITO_TEST_CALLS;
  }
});

test("agent worker stops follow-up loops that report no progress", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-no-progress-"));
  const siteDir = join(dir, "site");
  mkdirSync(join(siteDir, ".tunelito", "agent"), { recursive: true });
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const logPath = join(siteDir, ".tunelito", "agent", "log.md");
  const scriptPath = join(dir, "fake-agent.mjs");

  const item = comment({ id: "c_stuck", body: "Make broad mobile improvements.", pagePath: "/" });
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({ sourcePath: siteDir, comments: [item] }));
  writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    updatedAt: "2026-05-27T00:00:00.000Z",
    comments: {
      c_stuck: {
        id: "c_stuck",
        fingerprint: fingerprintComment(item),
        status: "needs_followup",
        attempts: 1,
        passes: 1,
        summary: "Started the mobile cleanup.",
        completedTasks: ["Fix bottom nav"],
        remainingTasks: ["Restyle cards"],
        filesChanged: ["index.html"],
      },
    },
  }, null, 2)}\n`);
  writeFileSync(scriptPath, `
process.stdin.resume();
await new Promise((resolve) => process.stdin.on("end", resolve));
console.log(JSON.stringify({
  comments: [{
    id: "c_stuck",
    status: "needs_followup",
    summary: "Still needs card restyling.",
    filesChanged: [],
    completedTasks: ["Fix bottom nav"],
    remainingTasks: ["Restyle cards"]
  }]
}));
`);

  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;
  const result = await runAgentPass({
    provider: "custom",
    command,
    commentsPath,
    targetPath: siteDir,
    workspaceRoot: siteDir,
    statePath,
    logPath,
    trigger: DEFAULT_AGENT_TRIGGER,
    maxAttempts: 2,
    maxPasses: 4,
    log() {},
  });

  assert.equal(result.statuses.c_stuck, "partial");
  const state = loadAgentState(statePath);
  assert.equal(state.comments.c_stuck.status, "partial");
  assert.match(state.comments.c_stuck.lastError, /without observable progress/);
  assert.deepEqual(state.comments.c_stuck.filesChanged, ["index.html"]);
});

test("agent worker preserves continuation context after a retryable follow-up failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-followup-retry-"));
  const siteDir = join(dir, "site");
  mkdirSync(join(siteDir, ".tunelito", "agent"), { recursive: true });
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const logPath = join(siteDir, ".tunelito", "agent", "log.md");
  const callsPath = join(dir, "calls.txt");
  const scriptPath = join(dir, "fake-agent.mjs");

  const item = comment({
    id: "c_retry",
    quote: "Old card copy.",
    body: "Update this card and the linked detail panel.",
    pagePath: "/index.html",
  });
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Old card copy.</p><p>Old panel copy.</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({ sourcePath: siteDir, comments: [item] }));
  writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    updatedAt: "2026-05-28T00:00:00.000Z",
    comments: {
      c_retry: {
        id: "c_retry",
        fingerprint: fingerprintComment(item),
        status: "needs_followup",
        attempts: 1,
        passes: 1,
        summary: "Updated the card copy.",
        filesChanged: ["index.html"],
        completedTasks: ["Update card copy"],
        remainingTasks: ["Update linked detail panel"],
        lastPassAt: "2026-05-28T00:00:00.000Z",
      },
    },
  }, null, 2)}\n`);
  writeFileSync(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const prompt = await new Promise((resolve) => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => resolve(raw));
});
const calls = process.env.TUNELITO_TEST_CALLS;
const next = (existsSync(calls) ? Number(readFileSync(calls, "utf8")) : 0) + 1;
writeFileSync(calls, String(next));
if (next === 1) {
  console.log(JSON.stringify({
    comments: [{ id: "other_comment", status: "resolved" }]
  }));
} else {
  if (!prompt.includes('"continuation"')) throw new Error("missing continuation block after retry");
  if (!prompt.includes("Update linked detail panel")) throw new Error("missing remaining task after retry");
  const html = readFileSync("index.html", "utf8").replace("Old panel copy.", "Detail panel copy is now finished.");
  writeFileSync("index.html", html);
  console.log(JSON.stringify({
    comments: [{
      id: "c_retry",
      status: "resolved",
      summary: "Finished the detail panel.",
      filesChanged: ["index.html"],
      completedTasks: ["Update linked detail panel"],
      remainingTasks: []
    }]
  }));
}
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
      maxAttempts: 3,
      maxPasses: 4,
      log() {},
    });
    assert.equal(first.statuses.c_retry, "pending");
    assert.equal(loadAgentState(statePath).comments.c_retry.previousStatus, "needs_followup");

    const second = await runAgentPass({
      provider: "custom",
      command,
      commentsPath,
      targetPath: siteDir,
      workspaceRoot: siteDir,
      statePath,
      logPath,
      trigger: DEFAULT_AGENT_TRIGGER,
      maxAttempts: 3,
      maxPasses: 4,
      log() {},
    });

    assert.equal(second.statuses.c_retry, "resolved");
    const state = loadAgentState(statePath);
    assert.equal(state.comments.c_retry.status, "resolved");
    assert.equal(state.comments.c_retry.passes, 2);
    assert.deepEqual(state.comments.c_retry.completedTasks, ["Update card copy", "Update linked detail panel"]);
    assert.match(readFileSync(join(siteDir, "index.html"), "utf8"), /Detail panel copy is now finished/);
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
    comments: [comment({ id: "c_bad", body: "Tighten this.", pagePath: "/" })],
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
  const item = comment({ id: "c_done", body: "Edit this." });
  const state = {
    comments: {
      c_done: {
        status: "resolved",
        fingerprint: fingerprintComment(item),
      },
    },
  };

  assert.equal(prepareAgentQueue([item], state, { trigger: DEFAULT_AGENT_TRIGGER }).pending.length, 0);

  const changed = comment({ id: "c_done", body: "Edit this differently." });
  const result = prepareAgentQueue([changed], state, { trigger: DEFAULT_AGENT_TRIGGER });
  assert.equal(result.changed, true);
  assert.equal(result.pending.length, 0);
  assert.equal(state.comments.c_done.status, "changed_needs_review");
});

test("agent fingerprint and prompt include comment scope and pass limits", () => {
  const pageNote = comment({
    id: "c_scope",
    scope: "page",
    quote: "",
    body: "Add a stronger one-day summary.",
  });
  const siteNote = { ...pageNote, scope: "site" };

  assert.notEqual(fingerprintComment(pageNote), fingerprintComment(siteNote));

  const prompt = buildAgentPrompt({
    comments: [siteNote],
    commentsPath: "/tmp/site.comments.md",
    workspaceRoot: "/tmp/site",
    statePath: "/tmp/site/.tunelito/agent/state.json",
    trigger: DEFAULT_AGENT_TRIGGER,
    maxAttempts: 2,
    maxPasses: DEFAULT_AGENT_MAX_PASSES,
  });

  assert.match(prompt, /"scope": "site"/);
  assert.match(prompt, /Site-scope comments/);
  assert.match(prompt, /may have no selected quote/);
  assert.match(prompt, /Max passes per comment/);
});

test("agent prompt includes owner context and comment author roles", () => {
  const visitor = comment({ id: "c_approved", author: "Rin", authorRole: "visitor", body: "Only run this after owner approval." });
  const prompt = buildAgentPrompt({
    comments: [
      comment({ id: "c_owner", author: "Chekos", authorRole: "owner", body: "Only run this after owner approval." }),
      {
        ...visitor,
        ownerApproval: {
          approvedBy: "Chekos",
          approvedAt: "2026-06-16T23:10:00.000Z",
          fingerprint: fingerprintComment(visitor),
        },
      },
    ],
    commentsPath: "/tmp/site.comments.md",
    workspaceRoot: "/tmp/site",
    statePath: "/tmp/site/.tunelito/agent/state.json",
    trigger: DEFAULT_AGENT_TRIGGER,
    maxAttempts: 2,
    maxPasses: DEFAULT_AGENT_MAX_PASSES,
    ownerName: "Chekos",
  });

  assert.match(prompt, /Owner: Chekos/);
  assert.match(prompt, /Policy: all/);
  assert.match(prompt, /"authorRole": "owner"/);
  assert.match(prompt, /"ownerApproval"/);
  assert.match(prompt, /"approvedBy": "Chekos"/);
  assert.doesNotMatch(prompt, /fingerprint/);
  assert.match(prompt, /prefer, ignore, or wait for owner feedback/);
});

test("agent trigger defaults to all comments and supports explicit mention filters", () => {
  const unmentioned = comment({ id: "c_2", body: "Make this shorter." });
  const mentioned = comment({ id: "c_3", body: "@Agent Make this shorter." });

  assert.equal(DEFAULT_AGENT_TRIGGER, "all");
  assert.equal(commentMatchesTrigger(unmentioned, DEFAULT_AGENT_TRIGGER), true);
  assert.equal(commentMatchesTrigger(mentioned, DEFAULT_AGENT_TRIGGER), true);
  assert.equal(commentMatchesTrigger(unmentioned, "@agent"), false);
  assert.equal(commentMatchesTrigger(mentioned, "@agent"), true);
  assert.equal(commentMatchesTrigger(unmentioned, "ALL"), true);
  assert.equal(DEFAULT_AGENT_POLICY, "all");
});

test("agent policy matches owner and mention combinations", () => {
  const visitor = comment({ id: "c_visitor", authorRole: "visitor", body: "Make this shorter." });
  const mentionedVisitor = comment({ id: "c_mentioned", authorRole: "visitor", body: "@agent Make this shorter." });
  const approvedVisitorBase = comment({
    id: "c_approved",
    authorRole: "visitor",
    body: "Make this shorter.",
  });
  const approvedVisitor = {
    ...approvedVisitorBase,
    ownerApproval: {
      approvedBy: "Chekos",
      approvedAt: "2026-06-16T23:10:00.000Z",
      fingerprint: fingerprintComment(approvedVisitorBase),
    },
  };
  const staleApprovedVisitor = {
    ...approvedVisitor,
    id: "c_stale_approved",
    body: "Make this much longer.",
  };
  const owner = comment({ id: "c_owner", authorRole: "owner", body: "Make this shorter." });

  assert.equal(commentMatchesAgentPolicy(visitor, { policy: "all", trigger: DEFAULT_AGENT_TRIGGER }), true);
  assert.equal(commentMatchesAgentPolicy(visitor, { policy: "mention", trigger: "@agent" }), false);
  assert.equal(commentMatchesAgentPolicy(mentionedVisitor, { policy: "mention", trigger: "@agent" }), true);
  assert.equal(commentMatchesAgentPolicy(owner, { policy: "owner", trigger: "@agent" }), true);
  assert.equal(commentMatchesAgentPolicy(approvedVisitor, { policy: "owner", trigger: "@agent" }), true);
  assert.equal(commentMatchesAgentPolicy(staleApprovedVisitor, { policy: "owner", trigger: "@agent" }), false);
  assert.equal(commentMatchesAgentPolicy(visitor, { policy: "owner", trigger: "@agent" }), false);
  assert.equal(commentMatchesAgentPolicy(owner, { policy: "owner-or-mention", trigger: "@agent" }), true);
  assert.equal(commentMatchesAgentPolicy(approvedVisitor, { policy: "owner-or-mention", trigger: "@agent" }), true);
  assert.equal(commentMatchesAgentPolicy(mentionedVisitor, { policy: "owner-or-mention", trigger: "@agent" }), true);
  assert.equal(commentMatchesAgentPolicy(visitor, { policy: "owner-or-mention", trigger: "@agent" }), false);

  const state = { comments: {} };
  const queue = prepareAgentQueue([visitor, mentionedVisitor, approvedVisitor, owner], state, {
    policy: "owner-or-mention",
    trigger: "@agent",
  });
  assert.deepEqual(queue.pending.map((item) => item.comment.id), ["c_mentioned", "c_approved", "c_owner"]);
});

test("mention-based agent policies require a marker trigger", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-policy-"));
  assert.throws(
    () => createAgentWorker({
      provider: "custom",
      command: "true",
      commentsPath: join(dir, "site.comments.md"),
      targetPath: dir,
      policy: "mention",
      trigger: DEFAULT_AGENT_TRIGGER,
    }),
    /requires --agent-trigger/,
  );
});

test("agent config normalizers keep validation order and trigger defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-config-"));
  const commentsPath = join(dir, "site.comments.md");

  assert.throws(
    () => normalizeAgentInboxConfig({ claimSeconds: 0 }),
    /inbox commands requires persistent comments/,
  );
  assert.throws(
    () => normalizeAgentInboxConfig({ commentsPath, claimSeconds: 0 }),
    /inbox commands requires a target HTML file or folder/,
  );
  assert.throws(
    () => normalizeAgentInboxConfig({ commentsPath, targetPath: dir, claimSeconds: 0 }),
    /--claim-ttl must be a positive integer/,
  );

  const config = normalizeAgentConfig({
    provider: "custom",
    command: "true",
    commentsPath,
    targetPath: dir,
    trigger: "",
  });
  assert.equal(config.trigger, DEFAULT_AGENT_TRIGGER);
  assert.throws(
    () => normalizeAgentConfig({
      provider: "custom",
      command: "true",
      commentsPath,
      targetPath: dir,
      policy: "mention",
      trigger: "all",
    }),
    /requires --agent-trigger/,
  );
});

test("comments watcher filename matching includes the inbox and temp file", () => {
  const commentsPath = "/tmp/site.comments.md";
  assert.equal(isWatchedCommentsFilename("site.comments.md", commentsPath), true);
  assert.equal(isWatchedCommentsFilename("site.comments.md.tmp", commentsPath), true);
  assert.equal(isWatchedCommentsFilename("index.html", commentsPath), false);
  assert.equal(isWatchedCommentsFilename(null, commentsPath), true);
});

test("agent worker wakes when the comments markdown file changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-watch-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const callsPath = join(dir, "calls.txt");
  const scriptPath = join(dir, "fake-agent.mjs");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(scriptPath, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
process.stdin.resume();
await new Promise((resolve) => process.stdin.on("end", resolve));
const calls = process.env.TUNELITO_TEST_CALLS;
writeFileSync(calls, String((existsSync(calls) ? Number(readFileSync(calls, "utf8")) : 0) + 1));
console.log(JSON.stringify({
  comments: [{
    id: "c_watch",
    status: "resolved",
    summary: "Handled the watched comment.",
    filesChanged: []
  }]
}));
`);

  process.env.TUNELITO_TEST_CALLS = callsPath;
  const worker = createAgentWorker({
    provider: "custom",
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
    commentsPath,
    targetPath: siteDir,
    statePath,
    intervalSeconds: 60,
    trigger: DEFAULT_AGENT_TRIGGER,
    log() {},
  });

  try {
    worker.start();
    await delay(100);
    writeFileSync(commentsPath, renderCommentsMarkdown({
      sourcePath: siteDir,
      comments: [comment({ id: "c_watch", body: "Make this watched comment actionable.", pagePath: "/" })],
    }));
    await waitUntil(() => loadAgentState(statePath).comments.c_watch?.status === "resolved", 3000);
    assert.equal(readFileSync(callsPath, "utf8"), "1");
  } finally {
    await worker.stop();
    delete process.env.TUNELITO_TEST_CALLS;
  }
});

test("agent inbox claims and records comments without spawning a worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-inbox-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [comment({ id: "c_active", body: "Make this active-agent ready.", pagePath: "/" })],
  }));

  const claimed = claimNextAgentComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimOwner: "codex-session",
    claimSeconds: 60,
  });

  assert.equal(claimed.comments.length, 1);
  assert.equal(claimed.comments[0].id, "c_active");
  assert.match(claimed.prompt, /Tunelito Agent Session Inbox/);
  assert.match(claimed.prompt, /tunelito inbox record/);
  assert.equal(loadAgentState(statePath).comments.c_active.status, "claimed");
  const claim = loadAgentState(statePath).comments.c_active.claim;
  assert.equal(claim.owner, "codex-session");
  assert.match(claimed.prompt, new RegExp(`--claim ${claim.id}`));

  const second = claimNextAgentComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
  });
  assert.equal(second.comments.length, 0);
  assert.equal(second.reason, "no-pending-comments");

  assert.throws(
    () => recordAgentSessionResult({
      commentsPath,
      targetPath: siteDir,
      statePath,
      result: {
        id: "c_active",
        status: "resolved",
        summary: "Made the active-agent workflow clear.",
      },
    }),
    /claimed by codex-session/,
  );
  assert.throws(
    () => recordAgentSessionResult({
      commentsPath,
      targetPath: siteDir,
      statePath,
      claimId: "claim_wrong",
      result: {
        id: "c_active",
        status: "resolved",
        summary: "Made the active-agent workflow clear.",
      },
    }),
    /not claimed by claim_wrong/,
  );

  const recorded = recordAgentSessionResult({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimId: claim.id,
    result: {
      id: "c_active",
      status: "resolved",
      summary: "Made the active-agent workflow clear.",
      filesChanged: ["index.html"],
      completedTasks: ["Updated copy"],
    },
  });

  assert.equal(recorded.state.status, "resolved");
  assert.equal(recorded.state.claim, undefined);
  assert.deepEqual(recorded.state.filesChanged, ["index.html"]);
  assert.match(readFileSync(join(siteDir, ".tunelito", "agent", "log.md"), "utf8"), /c_active: resolved/);
});

test("agent todo tracker shows pending, follow-up, and completed work", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-tracker-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [
      comment({ id: "c_pending", body: "Update the hero headline.", pagePath: "/" }),
      comment({ id: "c_follow", body: "Refresh the whole page.", pagePath: "/" }),
      comment({ id: "c_done", body: "Fix the footer.", pagePath: "/" }),
    ],
  }));

  const claimed = claimNextAgentComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    limit: 2,
    now: () => new Date("2026-06-10T00:00:00.000Z"),
  });
  recordAgentSessionResult({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimId: claimed.claim.id,
    now: () => new Date("2026-06-10T00:01:00.000Z"),
    result: {
      id: "c_pending",
      status: "resolved",
      summary: "Updated the hero headline.",
      completedTasks: ["Update the hero headline"],
    },
  });
  recordAgentSessionResult({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimId: claimed.claim.id,
    now: () => new Date("2026-06-10T00:02:00.000Z"),
    result: {
      id: "c_follow",
      status: "needs_followup",
      summary: "Refreshed the top section.",
      completedTasks: ["Refresh the top section"],
      remainingTasks: ["Refresh the footer"],
    },
  });

  const tracker = formatAgentTodoTracker({
    commentsPath,
    targetPath: siteDir,
    statePath,
    now: () => new Date("2026-06-10T00:03:00.000Z"),
  });

  assert.match(tracker, /Tunelito To Do/);
  assert.match(tracker, /## c_pending - resolved/);
  assert.match(tracker, /- \[x\] ~~Update the hero headline~~/);
  assert.match(tracker, /## c_follow - needs_followup/);
  assert.match(tracker, /- \[x\] ~~Refresh the top section~~/);
  assert.match(tracker, /- \[ \] Refresh the footer/);
  assert.match(tracker, /## c_done - pending/);
  assert.match(tracker, /- \[ \] Fix the footer\./);
});

test("agent inbox reclaims comments after claim ttl expires", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-inbox-ttl-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [comment({ id: "c_ttl", body: "Retry me after the lease expires.", pagePath: "/" })],
  }));

  const first = claimNextAgentComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimSeconds: 1,
    now: () => new Date("2026-06-10T00:00:00.000Z"),
  });
  assert.equal(first.comments.length, 1);

  const active = claimNextAgentComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    now: () => new Date("2026-06-10T00:00:00.500Z"),
  });
  assert.equal(active.comments.length, 0);
  assert.equal(active.reason, "no-pending-comments");

  const expired = claimNextAgentComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    now: () => new Date("2026-06-10T00:00:02.000Z"),
  });
  assert.equal(expired.comments.length, 1);
  assert.equal(expired.comments[0].id, "c_ttl");
  assert.notEqual(expired.claim.id, first.claim.id);
});

test("agent session watcher claims one comment and waits for recording before claiming another", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-session-watch-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  const logs = [];
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [
      comment({ id: "c_session_one", body: "Handle the first active-session comment.", pagePath: "/" }),
      comment({ id: "c_session_two", body: "Handle the second active-session comment.", pagePath: "/" }),
    ],
  }));

  const watcher = createAgentSessionWatcher({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimOwner: "codex-session",
    claimSeconds: 60,
    recordCommand: `tunelito inbox record ${JSON.stringify(siteDir)} --id <comment-id> --status <status> --summary "<short summary>"`,
    log: (message) => logs.push(message),
  });

  const first = await watcher.runOnce("manual");
  assert.equal(first.comments.length, 1);
  assert.equal(first.comments[0].id, "c_session_one");
  assert.match(logs.join("\n"), /Agent inbox: claimed c_session_one/);
  assert.match(logs.join("\n"), new RegExp(`--claim ${first.claim.id}`));

  const secondWhileClaimed = await watcher.runOnce("manual");
  assert.equal(secondWhileClaimed.reason, "active-claim");
  assert.equal(loadAgentState(statePath).comments.c_session_two, undefined);

  recordAgentSessionResult({
    commentsPath,
    targetPath: siteDir,
    statePath,
    claimId: first.claim.id,
    result: {
      id: "c_session_one",
      status: "resolved",
      summary: "Handled the first comment.",
      filesChanged: ["index.html"],
    },
  });

  const second = await watcher.runOnce("manual");
  assert.equal(second.comments.length, 1);
  assert.equal(second.comments[0].id, "c_session_two");
  assert.equal(loadAgentState(statePath).comments.c_session_two.status, "claimed");
  await watcher.stop();
});

test("agent inbox watch waits for comments markdown changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-inbox-watch-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");

  const waiting = waitForAgentInboxComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    waitIntervalSeconds: 1,
    timeoutSeconds: 3,
  });

  await delay(100);
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [comment({ id: "c_wait", body: "Handle this when it appears.", pagePath: "/" })],
  }));

  const result = await waiting;
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].id, "c_wait");
  assert.equal(loadAgentState(statePath).comments.c_wait.status, "claimed");
});

test("agent inbox watch returns timeout when no actionable comments arrive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-agent-inbox-timeout-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");

  const result = await waitForAgentInboxComments({
    commentsPath,
    targetPath: siteDir,
    statePath,
    waitIntervalSeconds: 1,
    timeoutSeconds: 1,
  });

  assert.equal(result.comments.length, 0);
  assert.equal(result.reason, "timeout");
});

test("buildAgentPrompt appends host instructions while preserving runtime context", () => {
  const prompt = buildAgentPrompt({
    comments: [comment({ id: "c_prompt", body: "Make this warmer." })],
    commentsPath: "/tmp/site.comments.md",
    workspaceRoot: "/tmp/site",
    statePath: "/tmp/site/.tunelito/agent/state.json",
    trigger: DEFAULT_AGENT_TRIGGER,
    maxAttempts: 2,
    promptAppend: "Prefer concise wording and preserve the existing layout.",
  });

  assert.match(prompt, /Core Behavior/);
  assert.match(prompt, /Host Instructions/);
  assert.match(prompt, /Prefer concise wording/);
  assert.match(prompt, /Comments To Address/);
  assert.match(prompt, /c_prompt/);
});

test("buildAgentPrompt can replace the built-in behavior prompt", () => {
  const prompt = buildAgentPrompt({
    comments: [comment({ id: "c_override", body: "Use a headline." })],
    commentsPath: "/tmp/site.comments.md",
    workspaceRoot: "/tmp/site",
    statePath: "/tmp/site/.tunelito/agent/state.json",
    trigger: DEFAULT_AGENT_TRIGGER,
    maxAttempts: 2,
    promptOverride: "You are an editorial HTML fixer. Make tasteful direct edits.",
  });

  assert.match(prompt, /editorial HTML fixer/);
  assert.doesNotMatch(prompt, /Treat each listed comment as reviewer feedback/);
  assert.match(prompt, /Output Contract/);
  assert.match(prompt, /Return only JSON/);
  assert.match(prompt, /c_override/);
  assert.match(defaultAgentBehaviorPrompt(), /Return only JSON/);
});

test("parseAgentResult accepts direct JSON, Claude JSON wrappers, follow-ups, and legacy buckets", () => {
  assert.deepEqual(parseAgentResult(JSON.stringify({
    comments: [{ id: "c_1", status: "success", summary: "Done", filesChanged: ["index.html"] }],
  })).comments, [{
    id: "c_1",
    status: "resolved",
    summary: "Done",
    filesChanged: ["index.html"],
    completedTasks: [],
    remainingTasks: [],
  }]);

  assert.deepEqual(parseAgentResult(JSON.stringify({
    result: "```json\n{\"comments\":[{\"id\":\"c_2\",\"status\":\"noop\"}]}\n```",
  })).comments[0], {
    id: "c_2",
    status: "no-op",
    summary: "",
    filesChanged: [],
    completedTasks: [],
    remainingTasks: [],
  });

  assert.deepEqual(parseAgentResult(JSON.stringify({
    blocked: [{ id: "c_3", summary: "Missing page" }],
  })).comments[0], {
    id: "c_3",
    status: "blocked",
    summary: "Missing page",
    filesChanged: [],
    completedTasks: [],
    remainingTasks: [],
  });

  assert.deepEqual(parseAgentResult(JSON.stringify({
    comments: [{
      id: "c_4",
      status: "needs_followup",
      summary: "Finished the first slice.",
      filesChanged: ["index.html"],
      completedTasks: ["Update heading"],
      remainingTasks: ["Update cards"],
    }],
  })).comments[0], {
    id: "c_4",
    status: "needs_followup",
    summary: "Finished the first slice.",
    filesChanged: ["index.html"],
    completedTasks: ["Update heading"],
    remainingTasks: ["Update cards"],
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

async function waitUntil(predicate, timeout = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for condition");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function comment(overrides = {}) {
  return {
    id: "c_test",
    author: "Jane",
    scope: "page",
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
