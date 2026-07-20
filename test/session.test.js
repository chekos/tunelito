import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTunelitoServer } from "../src/server.js";
import {
  SESSION_FORMAT,
  SESSION_VERSION,
  formatSessionStatus,
  inspectSession,
  sessionPathForTarget,
  writeSessionFile,
} from "../src/session.js";

function baseSession(targetPath, overrides = {}) {
  const now = "2026-07-20T12:00:00.000Z";
  return {
    format: SESSION_FORMAT,
    schemaVersion: SESSION_VERSION,
    sessionId: "s_expected",
    tunelitoVersion: "0.21.1",
    targetPath,
    sourceRoot: targetPath,
    directoryMode: true,
    commentsPath: join(targetPath, "site.comments.md"),
    persistence: "persistent",
    pid: 1234,
    lifecycle: "running",
    localUrl: "http://127.0.0.1:4317/?tunelito_key=secret",
    publicUrl: "https://example.trycloudflare.com/?tunelito_key=secret",
    tunnel: { enabled: true, state: "connected", error: null },
    agent: { mode: "agent-session", provider: "current", policy: "owner", trigger: "@agent" },
    startedAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

test("session status verifies a live listener by session identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-session-live-"));
  writeFileSync(join(dir, "index.html"), "<h1>Hello</h1>");
  const server = await createTunelitoServer({
    filePath: dir,
    host: "127.0.0.1",
    port: 0,
    accessKey: "secret",
    sessionId: "s_expected",
  });
  writeSessionFile(sessionPathForTarget(dir), baseSession(dir, {
    pid: process.pid,
    localUrl: server.localUrl,
    publicUrl: "",
    tunnel: { enabled: false, state: "disabled", error: null },
  }));

  try {
    const report = await inspectSession(dir);
    assert.equal(report.status, "running");
    assert.equal(report.process.listenerHealthy, true);
    assert.equal(report.process.identityMatches, true);
    assert.equal(report.process.viewerCount, 0);
  } finally {
    await server.close();
  }
});

test("session status does not treat PID or port reuse as healthy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-session-stale-"));
  mkdirSync(join(dir, ".tunelito"));
  writeSessionFile(sessionPathForTarget(dir), baseSession(dir));
  const report = await inspectSession(dir, {
    isProcessAlive: () => true,
    fetchFn: async () => new Response(JSON.stringify({
      sessionId: "s_different",
      viewerCount: 8,
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(report.status, "stale");
  assert.equal(report.process.pidAlive, true);
  assert.equal(report.process.listenerHealthy, false);
  assert.equal(report.process.viewerCount, null);
  assert.match(report.recovery.suggestion, /does not own this listener/);
});

test("session status reports tunnel loss as degraded and can redact keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-session-degraded-"));
  writeSessionFile(sessionPathForTarget(dir), baseSession(dir, {
    lifecycle: "degraded",
    tunnel: { enabled: true, state: "unavailable", error: "connection lost" },
  }));
  const report = await inspectSession(dir, {
    redact: true,
    isProcessAlive: () => true,
    commentsIndex: {
      summary: { unhandled: 3 },
      agentStatus: {
        comments: {
          c_1: { claim: { active: true } },
          c_2: { claim: { active: false } },
        },
      },
    },
    fetchFn: async () => new Response(JSON.stringify({
      sessionId: "s_expected",
      viewerCount: 2,
      lastActivityAt: "2026-07-20T12:05:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(report.status, "degraded");
  assert.equal(report.agent.activeClaims, 1);
  assert.equal(report.agent.unhandled, 3);
  assert.match(report.urls.local, /tunelito_key=REDACTED/);
  assert.doesNotMatch(JSON.stringify(report), /tunelito_key=secret/);
  assert.match(formatSessionStatus(report), /Status:\s+degraded/);
});

test("session status distinguishes stopped, missing, and corrupt metadata", async () => {
  const stopped = mkdtempSync(join(tmpdir(), "tunelito-session-stopped-"));
  writeSessionFile(sessionPathForTarget(stopped), baseSession(stopped, {
    lifecycle: "stopped",
    stoppedAt: "2026-07-20T12:10:00.000Z",
  }));
  assert.equal((await inspectSession(stopped, {
    isProcessAlive: () => false,
    fetchFn: async () => { throw new Error("offline"); },
  })).status, "stopped");

  const missing = mkdtempSync(join(tmpdir(), "tunelito-session-missing-"));
  await assert.rejects(() => inspectSession(missing), /No Tunelito session metadata/);

  const corrupt = mkdtempSync(join(tmpdir(), "tunelito-session-corrupt-"));
  mkdirSync(join(corrupt, ".tunelito"));
  writeFileSync(sessionPathForTarget(corrupt), "{broken");
  await assert.rejects(() => inspectSession(corrupt), /metadata is corrupt/);
});

test("session metadata remains discoverable after a served file is deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-session-deleted-target-"));
  const targetPath = join(dir, "notes.md");
  writeFileSync(targetPath, "# Notes");
  writeSessionFile(sessionPathForTarget(targetPath), baseSession(targetPath, {
    sourceRoot: dir,
    lifecycle: "stopped",
  }));
  rmSync(targetPath);

  const report = await inspectSession(targetPath, {
    isProcessAlive: () => false,
    fetchFn: async () => { throw new Error("offline"); },
  });
  assert.equal(report.status, "stopped");
  assert.equal(report.session.targetPath, targetPath);
});
