import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callMcpTool, handleMcpRequest, parseMcpMessages } from "../src/mcp.js";
import { loadAgentState } from "../src/agent-worker.js";
import { renderCommentsMarkdown } from "../src/comments.js";

test("MCP initialize and tools/list expose Tunelito tools", async () => {
  const initialize = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  assert.equal(initialize.result.serverInfo.name, "tunelito");
  assert.equal(initialize.result.capabilities.tools.listChanged, false);

  const listed = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    "tunelito_get_comments_index",
    "tunelito_get_pending_feedback",
    "tunelito_claim_next_comment",
    "tunelito_watch_next_comment",
    "tunelito_record_comment_result",
    "tunelito_get_inbox_status",
  ]);
  assert.match(listed.result.tools.find((tool) => tool.name === "tunelito_claim_next_comment").description, /Mutates/);
  assert.match(listed.result.tools.find((tool) => tool.name === "tunelito_get_pending_feedback").description, /Read-only/);
  for (const toolName of names) {
    assert.match(listed.result.tools.find((tool) => tool.name === toolName).description, /untrusted input/);
  }
  assert.match(listed.result.tools.find((tool) => tool.name === "tunelito_record_comment_result").description, /agent log/);
});

test("MCP parser accepts newline and Content-Length framed messages", () => {
  const lineMessage = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const framedMessage = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" });
  const input = Buffer.from([
    `${lineMessage}\n`,
    `Content-Length: ${Buffer.byteLength(framedMessage)}\r\n\r\n${framedMessage}`,
  ].join(""));

  const parsed = parseMcpMessages(input);

  assert.equal(parsed.remaining.length, 0);
  assert.deepEqual(parsed.messages.map((item) => item.message.id), [1, 2]);
});

test("MCP comments index returns structured content", async () => {
  const { sitePath, commentsPath } = createMcpFixture();

  const response = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "tunelito_get_comments_index",
      arguments: { targetPath: sitePath, includeAgentStatus: true },
    },
  });

  assert.equal(response.result.structuredContent.format, "tunelito-comments");
  assert.equal(response.result.structuredContent.commentsPath, commentsPath);
  assert.equal(response.result.structuredContent.summary.total, 2);
  assert.equal(response.result.structuredContent.agentStatus.comments.c_pending.status, "pending");
  assert.match(response.result.content[0].text, /tunelito-comments/);
});

test("MCP pending feedback respects agent policies without claiming", async () => {
  const { sitePath, statePath } = createMcpFixture();

  const result = await callMcpTool("tunelito_get_pending_feedback", {
    targetPath: sitePath,
    agentStatePath: statePath,
    agentPolicy: "mention",
    agentTrigger: "@agent",
  });

  assert.equal(result.status, "pending");
  assert.deepEqual(result.comments.map((comment) => comment.id), ["c_pending"]);
  assert.equal(loadAgentState(statePath).comments.c_pending, undefined);
});

test("MCP claim and record use existing claim semantics", async () => {
  const { sitePath, statePath } = createMcpFixture();
  const now = sequenceNow([
    "2026-06-17T00:00:00.000Z",
    "2026-06-17T00:01:00.000Z",
  ]);

  const claimed = await callMcpTool("tunelito_claim_next_comment", {
    targetPath: sitePath,
    agentStatePath: statePath,
    agentPolicy: "mention",
    agentTrigger: "@agent",
    claimOwner: "mcp-test",
  }, { now });

  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.comments[0].id, "c_pending");
  assert.equal(loadAgentState(statePath).comments.c_pending.status, "claimed");

  const missingClaim = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "tunelito_record_comment_result",
      arguments: {
        targetPath: sitePath,
        agentStatePath: statePath,
        id: "c_pending",
        status: "resolved",
        summary: "Handled.",
      },
    },
  }, { now });
  assert.equal(missingClaim.error.code, -32603);
  assert.match(missingClaim.error.message, /claimed by mcp-test/);

  const recorded = await callMcpTool("tunelito_record_comment_result", {
    targetPath: sitePath,
    agentStatePath: statePath,
    id: "c_pending",
    claimId: claimed.claim.id,
    status: "needs_followup",
    summary: "Updated first page.",
    filesChanged: ["index.html"],
    completedTasks: ["Updated first page"],
    remainingTasks: ["Update second page"],
  }, { now });

  assert.equal(recorded.status, "needs_followup");
  assert.deepEqual(recorded.completedTasks, ["Updated first page"]);
  assert.deepEqual(recorded.remainingTasks, ["Update second page"]);
  assert.equal(existsSync(recorded.logPath), true);
  assert.equal(loadAgentState(statePath).comments.c_pending.status, "needs_followup");
});

test("MCP inbox tools reject invalid targets with numeric JSON-RPC errors", async () => {
  const missingTarget = join(mkdtempSync(join(tmpdir(), "tunelito-mcp-missing-")), "missing-site");

  const response = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "tunelito_get_pending_feedback",
      arguments: { targetPath: missingTarget },
    },
  });

  assert.equal(response.error.code, -32602);
  assert.equal(typeof response.error.code, "number");
  assert.match(response.error.message, /Target path does not exist/);
});

test("MCP inbox status returns structured tracker", async () => {
  const { sitePath, statePath } = createMcpFixture();

  const status = await callMcpTool("tunelito_get_inbox_status", {
    targetPath: sitePath,
    agentStatePath: statePath,
    agentPolicy: "all",
  }, { now: () => new Date("2026-06-17T00:00:00.000Z") });

  assert.equal(status.statePath, statePath);
  assert.equal(status.tracker.comments.c_pending.status, "pending");
});

test("MCP watch returns timeout without spawning workers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-mcp-watch-"));
  const sitePath = join(dir, "site");
  mkdirSync(sitePath);
  writeFileSync(join(sitePath, "index.html"), "<!doctype html><h1>Site</h1>");

  const result = await callMcpTool("tunelito_watch_next_comment", {
    targetPath: sitePath,
    timeoutSeconds: 1,
    waitIntervalSeconds: 1,
  });

  assert.equal(result.status, "empty");
  assert.equal(result.reason, "timeout");
});

test("MCP unknown tools return JSON-RPC errors", async () => {
  const response = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "tunelito_unknown",
      arguments: {},
    },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Unknown tool/);
});

function createMcpFixture() {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-mcp-"));
  const sitePath = join(dir, "site");
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(sitePath, ".tunelito", "agent", "state.json");
  mkdirSync(sitePath);
  writeFileSync(join(sitePath, "index.html"), "<!doctype html><h1>Site</h1>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: sitePath,
    comments: [{
      id: "c_pending",
      author: "Dana",
      authorRole: "visitor",
      scope: "page",
      quote: "",
      body: "Please update this @agent.",
      pagePath: "/",
      created: "2026-06-17T00:00:00.000Z",
    }, {
      id: "c_owner",
      author: "Chekos",
      authorRole: "owner",
      scope: "site",
      quote: "",
      body: "Owner-wide note.",
      pagePath: "/",
      created: "2026-06-17T00:01:00.000Z",
    }],
  }));
  return { dir, sitePath, commentsPath, statePath };
}

function sequenceNow(values) {
  const dates = values.map((value) => new Date(value));
  let index = 0;
  return () => dates[Math.min(index++, dates.length - 1)];
}
