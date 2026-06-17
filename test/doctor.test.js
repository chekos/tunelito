import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDoctorReport } from "../src/doctor.js";
import { renderCommentsMarkdown } from "../src/comments.js";

const cleanDeps = {
  checkPort: async () => ({ available: true }),
  commandExists: () => false,
  now: () => new Date("2026-06-17T00:00:00.000Z"),
};

test("doctor runs runtime-only diagnostics without creating files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-runtime-"));

  const report = await buildDoctorReport({ cwd: dir, tunnel: false }, cleanDeps);

  assert.equal(report.format, "tunelito-doctor");
  assert.equal(report.version, 1);
  assert.equal(report.ok, true);
  assert.equal(report.checks.some((check) => check.id === "target.not-provided"), true);
  assert.deepEqual(readdirSync(dir), []);
});

test("doctor validates a single-file target and comments index", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-file-"));
  const targetPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(targetPath, "<!doctype html><h1>Page</h1>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: targetPath,
    comments: [{
      id: "c_doctor",
      author: "Dana",
      authorRole: "visitor",
      scope: "page",
      quote: "",
      body: "Doctor should count this.",
      created: "2026-06-17T00:00:00.000Z",
    }],
  }));

  const report = await buildDoctorReport({ targetPath, tunnel: false }, cleanDeps);

  assert.equal(report.ok, true);
  assert.equal(findCheck(report, "target.file").status, "pass");
  assert.equal(findCheck(report, "comments.index").details.summary.total, 1);
  assert.equal(findCheck(report, "agent-state.missing").status, "pass");
  assert.equal(existsSync(join(dir, ".tunelito")), false);
});

test("doctor validates folder targets and custom comments paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-folder-"));
  const targetPath = join(dir, "site");
  const commentsPath = join(dir, "notes.md");
  mkdirSync(targetPath);
  writeFileSync(join(targetPath, "index.html"), "<!doctype html><h1>Site</h1>");
  writeFileSync(commentsPath, renderCommentsMarkdown({ sourcePath: targetPath, comments: [] }));

  const report = await buildDoctorReport({ targetPath, commentsPath, tunnel: false }, cleanDeps);

  assert.equal(report.ok, true);
  assert.equal(findCheck(report, "target.folder").status, "pass");
  assert.equal(findCheck(report, "comments.path").details.commentsPath, commentsPath);
});

test("doctor reports invalid targets and damaged comments files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-invalid-"));
  const targetPath = join(dir, "page.txt");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(targetPath, "not html");
  writeFileSync(commentsPath, [
    "# Tunelito comments for `page.html`",
    "",
    "<!-- tunelito-comment: not-base64url -->",
    "## Broken at 2026-06-17 00:00:00 UTC",
    "",
    "Broken metadata.",
    "",
  ].join("\n"));

  const report = await buildDoctorReport({ targetPath, commentsPath, tunnel: false }, cleanDeps);

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "target.file").status, "fail");
  assert.equal(findCheck(report, "comments.metadata-invalid").status, "fail");
});

test("doctor reports invalid agent state JSON without rewriting it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-state-"));
  const targetPath = join(dir, "page.html");
  const statePath = join(dir, "state.json");
  writeFileSync(targetPath, "<!doctype html><h1>Page</h1>");
  writeFileSync(statePath, "{not json");

  const report = await buildDoctorReport({ targetPath, agentStatePath: statePath, tunnel: false }, cleanDeps);

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "agent-state.invalid-json").status, "fail");
});

test("doctor reports safety warnings for risky session shapes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-safety-"));
  const targetPath = join(dir, "page.html");
  writeFileSync(targetPath, "<!doctype html><h1>Page</h1>");

  const report = await buildDoctorReport({
    targetPath,
    host: "0.0.0.0",
    auth: false,
    tunnel: true,
    live: true,
    agentSession: true,
  }, cleanDeps);

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "safety.non-loopback-host").status, "warn");
  assert.equal(findCheck(report, "safety.no-auth-tunnel").status, "warn");
  assert.equal(findCheck(report, "safety.live-agent").status, "fail");
  assert.equal(findCheck(report, "safety.agent-input").status, "warn");
});

test("doctor reports unavailable ports and cloudflared fallback", async () => {
  const report = await buildDoctorReport({}, {
    ...cleanDeps,
    checkPort: async () => ({ available: false, error: "EADDRINUSE" }),
    commandExists: () => false,
  });

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "network.port").status, "fail");
  assert.equal(findCheck(report, "network.cloudflared").status, "warn");
});

test("doctor warns when port availability cannot be checked without binding", async () => {
  const report = await buildDoctorReport({}, {
    ...cleanDeps,
    checkPort: async () => ({ available: null, error: "lsof unavailable" }),
  });

  assert.equal(report.ok, true);
  assert.equal(findCheck(report, "network.port").status, "warn");
  assert.match(findCheck(report, "network.port").message, /without binding a socket/);
});

function findCheck(report, id) {
  const check = report.checks.find((item) => item.id === id);
  assert.ok(check, `missing check ${id}`);
  return check;
}
