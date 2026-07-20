import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimNextAgentComments,
  defaultAgentStatePath,
  saveAgentState,
} from "../src/agent-worker.js";
import { renderCommentsMarkdown } from "../src/comments.js";
import {
  SESSION_FORMAT,
  SESSION_VERSION,
  sessionPathForTarget,
  writeSessionFile,
} from "../src/session.js";
import {
  inspectOwnedAgentSessionClaim,
  waitForOwnedAgentSessionClaim,
} from "../scripts/retained-turn-wait.mjs";

function comment(id, body) {
  return {
    id,
    author: "Reviewer",
    authorRole: "visitor",
    scope: "page",
    quote: "",
    body,
    prefix: "",
    suffix: "",
    path: "",
    pagePath: "/",
    textStart: null,
    textEnd: null,
    created: "2026-07-20T18:00:00.000Z",
  };
}

function createFixture({ lifecycle = "running" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-retained-turn-"));
  const targetPath = join(dir, "site");
  const commentsPath = join(dir, "site.comments.md");
  mkdirSync(targetPath);
  const statePath = defaultAgentStatePath(targetPath);
  writeFileSync(join(targetPath, "index.html"), "<h1>Draft</h1>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: targetPath,
    comments: [comment("c_owned", "Replace the draft heading.")],
  }));
  writeSessionFile(sessionPathForTarget(targetPath), {
    format: SESSION_FORMAT,
    schemaVersion: SESSION_VERSION,
    sessionId: "s_retained",
    tunelitoVersion: "0.21.1",
    mode: "agent-session",
    targetPath,
    workspaceRoot: targetPath,
    sourceRoot: targetPath,
    commentsPath,
    statePath,
    policy: "all",
    trigger: "all",
    maxAttempts: 2,
    maxPasses: 3,
    recordCommand: `tunelito inbox record ${JSON.stringify(targetPath)} --id <comment-id> --status <status> --summary "<short summary>"`,
    agent: { mode: "agent-session", provider: "current", statePath, policy: "all", trigger: "all" },
    pid: process.pid,
    lifecycle,
    startedAt: "2026-07-20T18:00:00.000Z",
    lastActivityAt: "2026-07-20T18:00:00.000Z",
  });
  return { targetPath, commentsPath, statePath };
}

test("retained-turn observer returns only the active agent-session claim", () => {
  const fixture = createFixture();
  saveAgentState(fixture.statePath, {
    comments: {
      c_owned: {
        id: "c_owned",
        status: "claimed",
        claim: {
          id: "claim_owned",
          owner: "agent-session",
          claimedAt: "2026-07-20T18:00:00.000Z",
          expiresAt: "2026-07-20T18:15:00.000Z",
        },
      },
      c_other: {
        id: "c_other",
        status: "claimed",
        claim: {
          id: "claim_other",
          owner: "other-host",
          claimedAt: "2026-07-20T18:00:00.000Z",
          expiresAt: "2026-07-20T18:15:00.000Z",
        },
      },
    },
  }, () => new Date("2026-07-20T18:00:00.000Z"));

  const result = inspectOwnedAgentSessionClaim(fixture.targetPath, {
    now: () => new Date("2026-07-20T18:01:00.000Z"),
  });

  assert.equal(result.status, "claimed");
  assert.equal(result.claim.id, "claim_owned");
  assert.deepEqual(result.commentIds, ["c_owned"]);
  assert.match(result.prompt, /Replace the draft heading/);
  assert.match(result.prompt, /--claim claim_owned/);
  assert.doesNotMatch(result.prompt, /claim_other/);
});

test("retained-turn observer recovers an already persisted claim after host restart", async () => {
  const fixture = createFixture();
  const claimed = claimNextAgentComments({
    commentsPath: fixture.commentsPath,
    targetPath: fixture.targetPath,
    statePath: fixture.statePath,
    claimOwner: "agent-session",
    claimSeconds: 900,
    now: () => new Date(Date.now() - 1_000),
  });
  assert.equal(claimed.comments.length, 1);

  const result = await waitForOwnedAgentSessionClaim(fixture.targetPath, {
    timeoutSeconds: 1,
    pollIntervalMs: 250,
  });

  assert.equal(result.status, "claimed");
  assert.equal(result.claim.id, claimed.claim.id);
});

test("retained-turn wait exits when the host interrupts it", async () => {
  const fixture = createFixture();
  const controller = new AbortController();
  const waiting = waitForOwnedAgentSessionClaim(fixture.targetPath, {
    timeoutSeconds: 5,
    pollIntervalMs: 250,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 25);

  const result = await waiting;
  assert.equal(result.status, "interrupted");
  assert.equal(result.reason, "aborted");
});

test("retained-turn wait exits when session metadata says stopped", async () => {
  const fixture = createFixture({ lifecycle: "stopped" });
  const result = await waitForOwnedAgentSessionClaim(fixture.targetPath, {
    timeoutSeconds: 5,
    pollIntervalMs: 250,
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "session-stopped");
});
