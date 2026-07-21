import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { agentBlockedPaths, generateAccessKey, installSkill, isCliEntry, loadAgentPromptOptions, openBrowser, parseArgs, parseCommentsArgs, parseConfigArgs, parseDoctorArgs, parseInboxArgs, parseReviewArgs, parseSessionArgs, parseSkillInstallArgs, readBundledSkill, runCommentsCommand, runConfigCommand, runDoctorCommand, runInboxCommand, runMcpCommand, runReviewCommand, runSkillCommand, skillInstallDestination, updateAgentSessionPublicUrl, usage, VERSION, withReviewKey, writeAgentSessionFile } from "../bin/tunelito.js";
import { loadAgentState } from "../src/agent-worker.js";
import { renderCommentsMarkdown } from "../src/comments.js";

function streamCollector() {
  const chunks = [];
  return { write: (chunk) => { chunks.push(chunk); return true; }, text: () => chunks.join("") };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("CLI version matches package metadata", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("top-level help directs coding agents to the bundled workflow", () => {
  const help = usage();
  const codingAgentsIndex = help.indexOf("Coding agents:");
  const optionsIndex = help.indexOf("Options:");

  assert.ok(codingAgentsIndex > 0);
  assert.ok(codingAgentsIndex < optionsIndex);
  assert.match(help, /Before serving a review room[\s\S]*tunelito skill show/);
  assert.match(help, /Installation guidance:[\s\S]*tunelito skill setup/);
});

test("verified public URLs are persisted for agent-session recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-public-session-"));
  const targetPath = join(dir, "notes.md");
  writeFileSync(targetPath, "# Notes");
  const sessionPath = writeAgentSessionFile({
    targetPath,
    commentsPath: join(dir, "notes.comments.md"),
    statePath: join(dir, ".tunelito", "agent-state.json"),
    policy: "all",
    trigger: "@tunelito",
    maxAttempts: 3,
    maxPasses: 5,
    ownerName: "",
    promptAppend: "",
    reviewUrl: "http://127.0.0.1:4317/?tunelito_key=review-secret",
  });
  const publicUrl = "https://verified-session.trycloudflare.com/?tunelito_key=review-secret";

  updateAgentSessionPublicUrl(sessionPath, publicUrl);

  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  assert.equal(session.publicUrl, publicUrl);
  assert.equal(session.reviewUrl, publicUrl);
  assert.match(session.reviewWatchCommand, /verified-session\.trycloudflare\.com/);
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

test("parseArgs supports canonical ephemeral mode and deprecated live alias", () => {
  const opts = parseArgs(["page.html", "--ephemeral"]);
  const alias = parseArgs(["page.html", "--live"]);
  assert.equal(opts.ephemeral, true);
  assert.equal(opts.live, true);
  assert.equal(opts.liveAlias, undefined);
  assert.equal(alias.ephemeral, true);
  assert.equal(alias.liveAlias, true);
  assert.equal(opts.filePath, resolve("page.html"));
});

test("parseArgs supports named Markdown themes", () => {
  const opts = parseArgs(["notes.md", "--theme", "editorial"]);
  assert.equal(opts.theme, "editorial");
  assert.equal(opts.themeProvided, true);
  assert.throws(() => parseArgs(["notes.md", "--theme"]), /--theme requires a theme name/);
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

test("parseArgs supports active agent session options", () => {
  const opts = parseArgs([
    "site",
    "--agent-session",
    "--agent-policy",
    "owner-or-mention",
    "--agent-trigger",
    "@agent",
    "--agent-instructions",
    "Preserve layout.",
  ]);

  assert.equal(opts.agentSession, true);
  assert.equal(opts.agentPolicy, "owner-or-mention");
  assert.equal(opts.agentTrigger, "@agent");
  assert.equal(opts.agentInstructions, "Preserve layout.");
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
  assert.throws(() => parseArgs(["site", "--ephemeral", "--agent", "codex"]), /--agent requires persistent comments.*default persistent mode/);
});

test("parseArgs rejects agent session conflicts", () => {
  assert.throws(() => parseArgs(["site", "--live", "--agent-session"]), /--agent-session requires persistent comments.*--ephemeral/);
  assert.throws(() => parseArgs(["site", "--agent", "codex", "--agent-session"]), /Use either --agent or --agent-session/);
  assert.throws(() => parseArgs(["site", "--agent-session", "--agent-prompt", "A"]), /--agent-prompt is only supported/);
  assert.throws(() => parseArgs(["site", "--agent-session", "--agent-interval", "30"]), /--agent-session watches automatically/);
});

test("parseArgs rejects prompt options without an agent", () => {
  assert.throws(
    () => parseArgs(["site", "--agent-instructions", "Use short copy."]),
    /--agent prompt options require --agent/,
  );
});

test("parseDoctorArgs supports read-only diagnostic options", () => {
  const opts = parseDoctorArgs([
    "site",
    "--out",
    "site.comments.md",
    "--agent-state",
    "state.json",
    "--host",
    "0.0.0.0",
    "--port",
    "0",
    "--no-auth",
    "--no-tunnel",
    "--live",
    "--agent-session",
    "--agent-policy",
    "owner",
    "--json",
  ]);

  assert.equal(opts.targetPath, resolve("site"));
  assert.equal(opts.commentsPath, resolve("site.comments.md"));
  assert.equal(opts.agentStatePath, resolve("state.json"));
  assert.equal(opts.host, "0.0.0.0");
  assert.equal(opts.port, 0);
  assert.equal(opts.auth, false);
  assert.equal(opts.tunnel, false);
  assert.equal(opts.live, true);
  assert.equal(opts.agentSession, true);
  assert.equal(opts.agentPolicy, "owner");
  assert.equal(opts.format, "json");
});

test("runDoctorCommand prints parseable JSON and returns nonzero for errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-cli-"));
  const targetPath = join(dir, "notes.txt");
  writeFileSync(targetPath, "not html");

  const stdout = streamCollector();
  const code = await runDoctorCommand([targetPath, "--json"], {
    stdout,
    stderr: streamCollector(),
    deps: {
      checkPort: async () => ({ available: true }),
      commandExists: () => false,
    },
  });
  const report = JSON.parse(stdout.text());

  assert.equal(code, 1);
  assert.equal(report.format, "tunelito-doctor");
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.id === "target.file" && check.status === "fail"), true);
});

test("runDoctorCommand accepts Markdown targets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-doctor-md-"));
  const targetPath = join(dir, "notes.md");
  writeFileSync(targetPath, "# Notes");

  const stdout = streamCollector();
  const code = await runDoctorCommand([targetPath, "--json"], {
    stdout,
    stderr: streamCollector(),
    deps: {
      checkPort: async () => ({ available: true }),
      commandExists: () => false,
    },
  });
  const report = JSON.parse(stdout.text());

  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((check) => check.id === "target.file").details.sourceType, "markdown");
});

test("mcp help is side-effect free and unknown arguments fail", () => {
  const helpOut = streamCollector();
  const helpCode = runMcpCommand(["--help"], {
    stdout: helpOut,
    stderr: streamCollector(),
  });
  assert.equal(helpCode, 0);
  assert.match(helpOut.text(), /Tunelito MCP/);
  assert.match(helpOut.text(), /does not start/);

  const stderr = streamCollector();
  const badCode = runMcpCommand(["serve"], {
    stdout: streamCollector(),
    stderr,
  });
  assert.equal(badCode, 1);
  assert.match(stderr.text(), /Unknown mcp argument/);
});

test("review watch parses options and prints handoff events", async () => {
  const opts = parseReviewArgs([
    "watch",
    "site",
    "--url",
    "http://127.0.0.1:4317/?tunelito_key=secret",
    "--after",
    "latest",
    "--timeout",
    "5",
    "--json",
  ]);
  assert.equal(opts.command, "watch");
  assert.equal(opts.targetPath, resolve("site"));
  assert.equal(opts.url, "http://127.0.0.1:4317/?tunelito_key=secret");
  assert.equal(opts.after, "latest");
  assert.equal(opts.timeoutSeconds, 5);
  assert.equal(opts.format, "json");

  const stdout = streamCollector();
  const urls = [];
  const code = await runReviewCommand([
    "watch",
    "--url",
    "http://127.0.0.1:4317/?tunelito_key=secret",
    "--timeout",
    "5",
    "--json",
  ], {
    stdout,
    stderr: streamCollector(),
    fetchFn: async (url) => {
      urls.push(url.toString());
      return new Response(`${JSON.stringify({
        type: "review.completed",
        sequence: 3,
        targetPath: "/tmp/site",
        summary: { comments: 2, page: 1, site: 1, owner: 0, visitor: 2 },
      })}\n`, { status: 200 });
    },
  });

  assert.equal(code, 0);
  assert.match(urls[0], /\/__tunelito\/review-events\?/);
  assert.match(urls[0], /tunelito_key=secret/);
  assert.match(urls[0], /timeout=5/);
  assert.equal(JSON.parse(stdout.text()).sequence, 3);
});

test("review watch can read session metadata and returns nonzero on timeout", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-review-session-"));
  mkdirSync(join(siteDir, ".tunelito"), { recursive: true });
  writeFileSync(join(siteDir, ".tunelito", "session.json"), `${JSON.stringify({
    version: 1,
    reviewUrl: "http://127.0.0.1:4317/?tunelito_key=session-secret",
  })}\n`);

  const eventOut = streamCollector();
  const eventCode = await runReviewCommand(["watch", siteDir, "--json"], {
    stdout: eventOut,
    stderr: streamCollector(),
    fetchFn: async (url) => {
      assert.match(url.toString(), /tunelito_key=session-secret/);
      return new Response(`${JSON.stringify({
        type: "review.completed",
        sequence: 1,
        targetPath: siteDir,
        summary: { comments: 1, page: 1, site: 0, owner: 0, visitor: 1 },
      })}\n`, { status: 200 });
    },
  });
  assert.equal(eventCode, 0);
  assert.equal(JSON.parse(eventOut.text()).type, "review.completed");

  const timeoutOut = streamCollector();
  const timeoutCode = await runReviewCommand(["watch", "--url", "http://127.0.0.1:4317/", "--timeout", "1"], {
    stdout: timeoutOut,
    stderr: streamCollector(),
    fetchFn: async () => new Response(`${JSON.stringify({ type: "review.timeout", after: 0, timeoutSeconds: 1 })}\n`, { status: 408 }),
  });
  assert.equal(timeoutCode, 1);
  assert.match(timeoutOut.text(), /Timed out waiting for review\.completed/);

  assert.throws(() => parseReviewArgs(["watch", "site", "--format", "yaml"]), /Unsupported --format/);
});

test("parseCommentsArgs supports target and direct comments inspection", () => {
  const target = parseCommentsArgs(["inspect", "page.html", "--out", "review.md", "--agent-state", "state.json", "--json"]);
  assert.equal(target.command, "inspect");
  assert.equal(target.format, "json");
  assert.equal(target.targetPath, resolve("page.html"));
  assert.equal(target.commentsPath, resolve("review.md"));
  assert.equal(target.agentStatePath, resolve("state.json"));

  const markdownTarget = parseCommentsArgs(["inspect", "notes.md", "--json"]);
  assert.equal(markdownTarget.targetPath, resolve("notes.md"));
  assert.equal(markdownTarget.commentsPath, undefined);

  const direct = parseCommentsArgs(["inspect", "review.comments.md", "--json"]);
  assert.equal(direct.targetPath, undefined);
  assert.equal(direct.commentsPath, resolve("review.comments.md"));
  assert.equal(direct.requireCommentsFile, true);

  assert.throws(
    () => parseCommentsArgs(["inspect", "review.comments.md", "--out", "other.md"]),
    /--out is only supported/,
  );
});

test("runCommentsCommand prints parseable JSON for a comments inbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-cli-"));
  const sourcePath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(sourcePath, "<!doctype html><h1>Page</h1>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath,
    comments: [{
      id: "c_cli_index",
      author: "Dana",
      authorRole: "visitor",
      scope: "page",
      quote: "",
      body: "Index this.",
      created: "2026-06-17T00:00:00.000Z",
    }],
  }));

  const stdout = streamCollector();
  const stderr = streamCollector();
  const code = runCommentsCommand(["inspect", sourcePath, "--json"], { stdout, stderr });
  const index = JSON.parse(stdout.text());

  assert.equal(code, 0);
  assert.equal(stderr.text(), "");
  assert.equal(index.format, "tunelito-comments");
  assert.equal(index.version, 2);
  assert.equal(index.commentsPath, commentsPath);
  assert.equal(index.summary.pending, 1);
  assert.equal(index.summary.unhandled, 1);
  assert.equal(index.comments[0].agentStatus.status, "pending");
  assert.deepEqual(index.comments.map((comment) => comment.id), ["c_cli_index"]);
});

test("runCommentsCommand supports custom and direct comments paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-cli-custom-"));
  const sourcePath = join(dir, "page.html");
  const commentsPath = join(dir, "custom.comments.md");
  writeFileSync(sourcePath, "<!doctype html><h1>Page</h1>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath,
    comments: [{
      id: "c_cli_custom",
      author: "Dana",
      authorRole: "visitor",
      scope: "page",
      quote: "",
      body: "Index custom path.",
      created: "2026-06-17T00:00:00.000Z",
    }],
  }));

  const customOut = streamCollector();
  const customCode = runCommentsCommand(["inspect", sourcePath, "--out", commentsPath, "--json"], {
    stdout: customOut,
    stderr: streamCollector(),
  });
  const directOut = streamCollector();
  const directCode = runCommentsCommand(["inspect", commentsPath, "--json"], {
    stdout: directOut,
    stderr: streamCollector(),
  });

  assert.equal(customCode, 0);
  assert.equal(JSON.parse(customOut.text()).comments[0].id, "c_cli_custom");
  assert.equal(directCode, 0);
  assert.equal(JSON.parse(directOut.text()).comments[0].id, "c_cli_custom");
});

test("runCommentsCommand returns diagnostics for missing direct comments files", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-cli-missing-"));
  const commentsPath = join(dir, "missing.comments.md");
  const stdout = streamCollector();
  const code = runCommentsCommand(["inspect", commentsPath, "--json"], {
    stdout,
    stderr: streamCollector(),
  });
  const index = JSON.parse(stdout.text());

  assert.equal(code, 1);
  assert.equal(index.ok, false);
  assert.equal(index.diagnostics[0].code, "comments.file-missing");
});

test("parseInboxArgs supports watch and record options", () => {
  const watch = parseInboxArgs([
    "watch",
    "site",
    "--agent-policy",
    "owner-or-mention",
    "--agent-trigger",
    "@agent",
    "--limit",
    "2",
    "--claim-owner",
    "codex",
    "--timeout",
    "5",
    "--format",
    "json",
  ]);
  assert.equal(watch.command, "watch");
  assert.equal(watch.wait, true);
  assert.equal(watch.agentPolicy, "owner-or-mention");
  assert.equal(watch.limit, 2);
  assert.equal(watch.claimOwner, "codex");
  assert.equal(watch.timeoutSeconds, 5);

  const record = parseInboxArgs([
    "record",
    "site",
    "--id",
    "c_1",
    "--claim",
    "claim_123",
    "--status",
    "needs_followup",
    "--summary",
    "Started",
    "--file",
    "index.html",
    "--completed",
    "Updated hero",
    "--remaining",
    "Update footer",
  ]);
  assert.equal(record.command, "record");
  assert.equal(record.id, "c_1");
  assert.equal(record.claimId, "claim_123");
  assert.equal(record.status, "needs_followup");
  assert.deepEqual(record.filesChanged, ["index.html"]);
  assert.deepEqual(record.completedTasks, ["Updated hero"]);
  assert.deepEqual(record.remainingTasks, ["Update footer"]);
  assert.throws(() => parseInboxArgs(["next", "site", "--claim", "claim_123"]), /--claim is only supported/);

  const status = parseInboxArgs(["status", "site", "--format", "json"]);
  assert.equal(status.command, "status");
  assert.equal(status.format, "json");

  const next = parseInboxArgs(["next", "site"]);
  assert.equal(next.claimOwner, "inbox-command");
});

test("runInboxCommand claims, records, and reports comment status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-inbox-cli-"));
  const siteDir = join(dir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(dir, "site.comments.md");
  const statePath = join(siteDir, ".tunelito", "agent", "state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><p>Draft</p></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [{ id: "c_cli", author: "Dana", authorRole: "visitor", scope: "page", quote: "", body: "Make this concise.", prefix: "", suffix: "", path: "", pagePath: "/", textStart: null, textEnd: null, created: "2026-06-10T00:00:00.000Z" }],
  }));

  const nextOut = streamCollector();
  const nextCode = await runInboxCommand([
    "next",
    siteDir,
    "--out",
    commentsPath,
    "--agent-state",
    statePath,
    "--format",
    "ids",
  ], { stdout: nextOut });

  assert.equal(nextCode, 0);
  assert.equal(nextOut.text(), "c_cli\n");
  assert.equal(loadAgentState(statePath).comments.c_cli.status, "claimed");
  const claimId = loadAgentState(statePath).comments.c_cli.claim.id;

  const claimedStatusOut = streamCollector();
  const claimedStatusCode = await runInboxCommand([
    "status",
    siteDir,
    "--out",
    commentsPath,
    "--agent-state",
    statePath,
  ], { stdout: claimedStatusOut });

  assert.equal(claimedStatusCode, 0);
  assert.match(claimedStatusOut.text(), /## c_cli - claimed/);
  assert.match(claimedStatusOut.text(), new RegExp(`Claim: ${claimId} by inbox-command \\(active`));
  assert.match(claimedStatusOut.text(), /- \[ \] Being worked on: Make this concise\./);

  const recordOut = streamCollector();
  const recordCode = await runInboxCommand([
    "record",
    siteDir,
    "--out",
    commentsPath,
    "--agent-state",
    statePath,
    "--id",
    "c_cli",
    "--claim",
    claimId,
    "--status",
    "resolved",
    "--summary",
    "Made the copy concise.",
    "--file",
    "index.html",
  ], { stdout: recordOut });

  assert.equal(recordCode, 0);
  assert.match(recordOut.text(), /Recorded c_cli as resolved/);
  assert.match(recordOut.text(), /Tunelito To Do/);
  assert.match(recordOut.text(), /- \[x\] ~~Made the copy concise\.~~/);
  assert.equal(loadAgentState(statePath).comments.c_cli.status, "resolved");
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

test("parseArgs accepts a Markdown stylesheet href", () => {
  const opts = parseArgs(["notes.md", "--markdown-css", "/review.css"]);
  assert.equal(opts.filePath, resolve("notes.md"));
  assert.equal(opts.markdownCssHref, "/review.css");
  assert.equal(opts.markdownCssProvided, true);
  assert.throws(() => parseArgs(["notes.md", "--markdown-css", "javascript:alert(1)"]), /--markdown-css/);
});

test("config show resolves project settings and reports CLI overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-config-cli-"));
  const homePath = join(dir, "home");
  const projectPath = join(dir, "project");
  mkdirSync(join(homePath, ".config", "tunelito"), { recursive: true });
  mkdirSync(projectPath);
  writeFileSync(join(homePath, ".config", "tunelito", "config.json"), JSON.stringify({ theme: "editorial" }));
  writeFileSync(join(projectPath, "tunelito.config.json"), JSON.stringify({ theme: "technical" }));
  writeFileSync(join(projectPath, "notes.md"), "# Notes");

  const parsed = parseConfigArgs(["show", join(projectPath, "notes.md"), "--theme", "bns-pitaya", "--json"]);
  assert.equal(parsed.command, "show");
  assert.equal(parsed.theme, "bns-pitaya");
  assert.equal(parsed.format, "json");

  const stdout = streamCollector();
  const code = runConfigCommand([
    "show",
    join(projectPath, "notes.md"),
    "--theme",
    "bns-pitaya",
    "--json",
  ], {
    stdout,
    stderr: streamCollector(),
    env: {},
    homePath,
  });
  assert.equal(code, 0);
  const report = JSON.parse(stdout.text());
  assert.equal(report.format, "tunelito-config");
  assert.equal(report.version, 1);
  assert.equal(report.theme.value, "bns-pitaya");
  assert.equal(report.theme.source, "cli");
  assert.equal(report.configFiles.global.exists, true);
  assert.equal(report.configFiles.project.exists, true);
  assert.deepEqual(report.availableThemes.map(({ name }) => name), ["default", "editorial", "technical", "bns-pitaya"]);
});

test("config show reports BNS Pitaya as the implicit theme", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-config-cli-default-"));
  const homePath = join(dir, "home");
  const targetPath = join(dir, "notes.md");
  mkdirSync(homePath);
  writeFileSync(targetPath, "# Notes");

  const stdout = streamCollector();
  const code = runConfigCommand(["show", targetPath, "--json"], {
    stdout,
    stderr: streamCollector(),
    env: {},
    homePath,
  });

  assert.equal(code, 0);
  const report = JSON.parse(stdout.text());
  assert.equal(report.theme.value, "bns-pitaya");
  assert.equal(report.theme.source, "default");
});

test("config show fails clearly for malformed project JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-config-cli-invalid-"));
  const homePath = join(dir, "home");
  mkdirSync(join(homePath, ".config", "tunelito"), { recursive: true });
  writeFileSync(join(dir, "tunelito.config.json"), "{ broken");
  const stderr = streamCollector();
  const code = runConfigCommand(["show", dir], {
    stdout: streamCollector(),
    stderr,
    env: {},
    homePath,
  });
  assert.equal(code, 1);
  assert.match(stderr.text(), new RegExp(`Invalid project Tunelito config at ${escapeRegex(join(dir, "tunelito.config.json"))}`));
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

test("readBundledSkill returns the distributable Tunelito skill markdown", () => {
  const content = readBundledSkill();
  assert.match(content, /^---\nname: tunelito/);
  assert.match(content, /## Agent worker reference/);
});

test("skill show prints the bundled skill to stdout", () => {
  const stdout = streamCollector();
  const stderr = streamCollector();
  const code = runSkillCommand(["show"], { stdout, stderr });
  assert.equal(code, 0);
  assert.match(stdout.text(), /^---\nname: tunelito/);
  assert.match(stdout.text(), /## Step 3 -- Process the comments/);
  assert.match(stdout.text(), /Default to the rolling active-agent loop/);
  assert.match(stdout.text(), /Batch review is an explicit opt-in/);
  assert.equal(stderr.text(), "");
});

test("skill show surfaces a read failure instead of throwing", () => {
  const stdout = streamCollector();
  const stderr = streamCollector();
  const code = runSkillCommand(["show"], {
    stdout,
    stderr,
    readSkill() {
      throw new Error("disk gone");
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout.text(), "");
  assert.match(stderr.text(), /Could not read the bundled Tunelito skill: disk gone/);
});

test("skill with no subcommand prints install help", () => {
  const stdout = streamCollector();
  const code = runSkillCommand([], { stdout, stderr: streamCollector() });
  assert.equal(code, 0);
  assert.match(stdout.text(), /tunelito skill show/);
  assert.match(stdout.text(), /tunelito skill setup/);
});

test("skill setup prints no-write cross-agent onboarding guidance", () => {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "tunelito-skill-setup-"));
  const stdout = streamCollector();
  const stderr = streamCollector();
  try {
    process.chdir(dir);
    const before = readdirSync(dir);
    const code = runSkillCommand(["setup"], { stdout, stderr });
    const after = readdirSync(dir);

    assert.equal(code, 0);
    assert.equal(stderr.text(), "");
    assert.deepEqual(after, before);
    assert.match(stdout.text(), /Tunelito agent setup/);
    assert.match(stdout.text(), /npx --yes tunelito skill show/);
    assert.match(stdout.text(), /skill install --agent claude --scope project --dry-run/);
    assert.match(stdout.text(), /skill install --agent codex --scope user/);
    assert.match(stdout.text(), /~\/\.agents\/skills\/tunelito\/SKILL\.md/);
    assert.match(stdout.text(), /~\/\.claude\/skills\/tunelito\/SKILL\.md/);
    assert.match(stdout.text(), /Setup prints guidance only/);
    assert.match(stdout.text(), /Do not present --no-auth as local-only/);
    assert.match(stdout.text(), /--no-tunnel/);
    assert.match(stdout.text(), /https:\/\/tunelito\.dev\/agent-setup/);
  } finally {
    process.chdir(cwd);
  }
});

test("skill install resolves documented Codex and Claude user and project paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-skill-paths-"));
  const project = join(dir, "project");
  const nested = join(project, "packages", "site");
  const home = join(dir, "home");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(nested, { recursive: true });

  assert.equal(
    skillInstallDestination({ agent: "codex", scope: "user", cwd: nested, homePath: home }),
    join(home, ".agents", "skills", "tunelito", "SKILL.md"),
  );
  assert.equal(
    skillInstallDestination({ agent: "codex", scope: "project", cwd: nested, homePath: home }),
    join(project, ".agents", "skills", "tunelito", "SKILL.md"),
  );
  assert.equal(
    skillInstallDestination({ agent: "claude", scope: "user", cwd: nested, homePath: home }),
    join(home, ".claude", "skills", "tunelito", "SKILL.md"),
  );
  assert.equal(
    skillInstallDestination({ agent: "claude", scope: "project", cwd: nested, homePath: home }),
    join(project, ".claude", "skills", "tunelito", "SKILL.md"),
  );
});

test("skill install supports dry-run, exact bytes, no-overwrite, and force replacement", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-skill-install-"));
  mkdirSync(join(dir, ".git"));
  const content = readBundledSkill();
  const destination = join(dir, ".agents", "skills", "tunelito", "SKILL.md");

  const preview = installSkill({ agent: "codex", scope: "project", cwd: dir, homePath: dir, dryRun: true, content });
  assert.equal(preview.action, "would-create");
  assert.equal(existsSync(destination), false);

  const created = installSkill({ agent: "codex", scope: "project", cwd: dir, homePath: dir, content });
  assert.equal(created.action, "created");
  assert.equal(readFileSync(destination, "utf8"), content.endsWith("\n") ? content : `${content}\n`);

  writeFileSync(destination, "locally modified\n");
  const blocked = installSkill({ agent: "codex", scope: "project", cwd: dir, homePath: dir, content });
  assert.equal(blocked.action, "blocked");
  assert.equal(readFileSync(destination, "utf8"), "locally modified\n");

  const replaced = installSkill({ agent: "codex", scope: "project", cwd: dir, homePath: dir, force: true, content });
  assert.equal(replaced.action, "replaced");
  assert.equal(readFileSync(destination, "utf8"), content.endsWith("\n") ? content : `${content}\n`);
});

test("skill install parsing requires an explicit agent and scope", () => {
  assert.deepEqual(
    { ...parseSkillInstallArgs(["--agent", "codex", "--scope", "user", "--dry-run"]), cwd: "", homePath: "" },
    { agent: "codex", scope: "user", force: false, dryRun: true, cwd: "", homePath: "" },
  );
  assert.throws(() => parseSkillInstallArgs(["--agent", "codex"]), /--scope must be user or project/);
  assert.throws(() => parseSkillInstallArgs(["--agent", "cursor", "--scope", "user"]), /--agent must be codex or claude/);
});

test("session status parsing defaults to cwd and supports JSON redaction", () => {
  const opts = parseSessionArgs(["status", "--json", "--redact"]);
  assert.equal(opts.targetPath, resolve(process.cwd()));
  assert.equal(opts.format, "json");
  assert.equal(opts.redact, true);
});

test("skill rejects an unknown subcommand with a nonzero exit", () => {
  const stdout = streamCollector();
  const stderr = streamCollector();
  const code = runSkillCommand(["bogus"], { stdout, stderr });
  assert.equal(code, 1);
  assert.match(stderr.text(), /Unknown skill command: bogus/);
});
