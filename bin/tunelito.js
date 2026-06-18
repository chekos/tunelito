#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  AGENT_POLICIES,
  DEFAULT_AGENT_INTERVAL_SECONDS,
  DEFAULT_AGENT_MAX_ATTEMPTS,
  DEFAULT_AGENT_MAX_PASSES,
  DEFAULT_AGENT_POLICY,
  DEFAULT_AGENT_TRIGGER,
  DEFAULT_INBOX_CLAIM_SECONDS,
  DEFAULT_INBOX_WAIT_INTERVAL_SECONDS,
  agentWorkspaceRoot,
  claimNextAgentComments,
  createAgentSessionWatcher,
  defaultAgentLogPath,
  createAgentWorker,
  defaultAgentStatePath,
  formatAgentTodoTracker,
  normalizeAgentPolicy,
  recordAgentSessionResult,
  waitForAgentInboxComments,
} from "../src/agent-worker.js";
import { buildCommentsIndex } from "../src/comment-index.js";
import { defaultCommentsPath } from "../src/comments.js";
import { buildDoctorReport } from "../src/doctor.js";
import { createMcpServer } from "../src/mcp.js";
import { createTunelitoServer } from "../src/server.js";
import { startCloudflareTunnel } from "../src/tunnel.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = pkg.version;

function usage() {
  return `Tunelito ${VERSION}

Usage: tunelito <page.html|folder> [options]
       tunelito doctor [page.html|folder] [options]
       tunelito mcp
       tunelito comments inspect <page.html|folder|comments.md> [options]
       tunelito inbox <next|watch|status|record> <page.html|folder> [options]
       tunelito skill show

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page-or-folder>.comments.md)
  --owner <name>        Assign this editable owner name to the local viewer
  --live                Use ephemeral live collaboration mode; do not write comments to disk
  --agent <codex|claude|custom>
                        Run a local coding-agent worker for persistent comments
  --agent-command <cmd> Custom shell command for --agent custom; prompt is sent on stdin
  --agent-interval <s>  Agent fallback polling interval in seconds (default: ${DEFAULT_AGENT_INTERVAL_SECONDS})
  --agent-policy <mode> Which comments are actionable: ${AGENT_POLICIES.join("|")} (default: ${DEFAULT_AGENT_POLICY})
  --agent-trigger <txt> Marker for mention policies, or "all" (default: ${DEFAULT_AGENT_TRIGGER})
  --agent-instructions <txt>
                        Append host instructions to the built-in agent prompt
  --agent-instructions-file <path>
                        Append host instructions from a file
  --agent-prompt <txt>  Replace the built-in agent behavior prompt
  --agent-prompt-file <path>
                        Replace the built-in agent behavior prompt from a file
  --agent-max-attempts <n>
                        Stop retrying a comment after n attempts (default: ${DEFAULT_AGENT_MAX_ATTEMPTS})
  --agent-max-passes <n>
                        Stop continuing a multi-pass comment after n agent passes (default: ${DEFAULT_AGENT_MAX_PASSES})
  --agent-state <path>  Agent resolution ledger (default: <target>/.tunelito/agent/state.json)
  --agent-session       Watch comments for the current agent session; do not spawn a worker
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --no-auth             Disable the generated review-key URL gate
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show this help

Commands:
  doctor                Run read-only local setup and safety diagnostics
  mcp                   Start a stdio MCP server for comments and inbox tools
  comments inspect      Print a structured JSON index for a Tunelito comments inbox
  inbox next            Claim the next pending comment and print an agent prompt
  inbox watch           Wait for the next pending comment, then print an agent prompt
  inbox status          Print a live to-do tracker from the comments inbox and ledger
  inbox record          Record the active agent's result for one comment
  skill show            Print the distributable Tunelito agent skill (SKILL.md)
                        for a coding agent to install
`;
}

export function parseArgs(argv) {
  const opts = {
    host: "127.0.0.1",
    port: 4317,
    tunnel: true,
    auth: true,
    open: false,
    agentIntervalSeconds: DEFAULT_AGENT_INTERVAL_SECONDS,
    agentPolicy: DEFAULT_AGENT_POLICY,
    agentTrigger: DEFAULT_AGENT_TRIGGER,
    agentMaxAttempts: DEFAULT_AGENT_MAX_ATTEMPTS,
    agentMaxPasses: DEFAULT_AGENT_MAX_PASSES,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "-v" || arg === "--version") {
      opts.version = true;
    } else if (arg === "--no-tunnel") {
      opts.tunnel = false;
    } else if (arg === "--live") {
      opts.live = true;
    } else if (arg === "--agent") {
      const value = requiredValue(argv[++i], "--agent", "provider: codex, claude, or custom");
      opts.agent = value.toLowerCase();
    } else if (arg === "--agent-session") {
      opts.agentSession = true;
    } else if (arg === "--agent-command") {
      const value = requiredValue(argv[++i], "--agent-command");
      opts.agentCommand = value;
      if (!opts.agent) opts.agent = "custom";
    } else if (arg === "--agent-interval") {
      const value = argv[++i];
      opts.agentIntervalSeconds = parseIntegerValue(value, "--agent-interval", { min: 1 });
      opts.agentIntervalProvided = true;
    } else if (arg === "--agent-policy") {
      opts.agentPolicy = normalizeAgentPolicy(requiredValue(argv[++i], "--agent-policy"));
    } else if (arg === "--agent-trigger") {
      opts.agentTrigger = requiredValue(argv[++i], "--agent-trigger");
    } else if (arg === "--agent-instructions") {
      opts.agentInstructions = requiredValue(argv[++i], "--agent-instructions");
    } else if (arg === "--agent-instructions-file") {
      const value = requiredValue(argv[++i], "--agent-instructions-file");
      opts.agentInstructionsPath = resolve(value);
    } else if (arg === "--agent-prompt") {
      opts.agentPrompt = requiredValue(argv[++i], "--agent-prompt");
    } else if (arg === "--agent-prompt-file") {
      const value = requiredValue(argv[++i], "--agent-prompt-file");
      opts.agentPromptPath = resolve(value);
    } else if (arg === "--agent-max-attempts") {
      const value = argv[++i];
      opts.agentMaxAttempts = parseIntegerValue(value, "--agent-max-attempts", { min: 1 });
    } else if (arg === "--agent-max-passes") {
      const value = argv[++i];
      opts.agentMaxPasses = parseIntegerValue(value, "--agent-max-passes", { min: 1 });
    } else if (arg === "--agent-state") {
      const value = requiredValue(argv[++i], "--agent-state");
      opts.agentStatePath = resolve(value);
    } else if (arg === "--no-auth") {
      opts.auth = false;
    } else if (arg === "--open") {
      opts.open = true;
    } else if (arg === "--port") {
      const value = argv[++i];
      opts.port = parseIntegerValue(value, "--port", { min: 0, max: 65535 });
    } else if (arg === "--host") {
      opts.host = requiredValue(argv[++i], "--host");
    } else if (arg === "--out") {
      const value = requiredValue(argv[++i], "--out");
      opts.commentsPath = resolve(value);
    } else if (arg === "--owner" || arg === "--owner-name") {
      opts.ownerName = requiredName(argv[++i], arg);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(`Expected one HTML file or folder, got ${positional.length}`);
  }
  if (opts.agent === "custom" && !opts.agentCommand) {
    throw new Error("--agent custom requires --agent-command");
  }
  if (opts.agent && !["codex", "claude", "custom"].includes(String(opts.agent).toLowerCase())) {
    throw new Error(`Unsupported --agent provider: ${opts.agent}`);
  }
  if (opts.agentCommand && opts.agent !== "custom") {
    throw new Error("--agent-command can only be used with --agent custom");
  }
  if ((opts.agentInstructions || opts.agentInstructionsPath || opts.agentPrompt || opts.agentPromptPath) && !opts.agent && !opts.agentSession) {
    throw new Error("--agent prompt options require --agent, --agent-command, or --agent-session");
  }
  if ((opts.agentPrompt || opts.agentPromptPath) && opts.agentSession && !opts.agent) {
    throw new Error("--agent-prompt is only supported with --agent or --agent-command");
  }
  if (opts.agentIntervalProvided && opts.agentSession && !opts.agent) {
    throw new Error("--agent-interval is only supported with --agent; --agent-session watches automatically");
  }
  if (opts.agentPolicy !== DEFAULT_AGENT_POLICY && !opts.agent && !opts.agentSession) {
    throw new Error("--agent-policy requires --agent, --agent-command, or --agent-session");
  }
  validateMentionAgentPolicy(opts.agentPolicy, opts.agentTrigger);
  if (opts.agentInstructions && opts.agentInstructionsPath) {
    throw new Error("Use either --agent-instructions or --agent-instructions-file, not both");
  }
  if (opts.agentPrompt && opts.agentPromptPath) {
    throw new Error("Use either --agent-prompt or --agent-prompt-file, not both");
  }
  if (opts.live && opts.agent) {
    throw new Error("--agent requires persistent comments; remove --live");
  }
  if (opts.live && opts.agentSession) {
    throw new Error("--agent-session requires persistent comments; remove --live");
  }
  if (opts.agent && opts.agentSession) {
    throw new Error("Use either --agent or --agent-session, not both");
  }
  if (positional[0]) opts.filePath = resolve(positional[0]);
  return opts;
}

function requiredValue(value, option, detail = "value") {
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a ${detail}`);
  return value;
}

function requiredName(value, option) {
  const name = cleanName(requiredValue(value, option, "name"));
  if (!name) throw new Error(`${option} requires a name`);
  return name;
}

function parseIntegerValue(value, option, { min, max } = {}) {
  if (!/^\d+$/.test(String(value || ""))) throw new Error(`Invalid ${option} value: ${value}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (min != null && number < min) || (max != null && number > max)) {
    throw new Error(`Invalid ${option} value: ${value}`);
  }
  return number;
}

function cleanName(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, 80);
}

function isAllAgentTrigger(value) {
  return !value || String(value).trim().toLowerCase() === "all";
}

function validateMentionAgentPolicy(policy, trigger) {
  if (["mention", "owner-or-mention"].includes(policy) && isAllAgentTrigger(trigger)) {
    throw new Error(`--agent-policy ${policy} requires --agent-trigger with a marker such as @agent`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "doctor") {
    process.exitCode = await runDoctorCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "mcp") {
    process.exitCode = runMcpCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "comments") {
    process.exitCode = runCommentsCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "inbox") {
    process.exitCode = await runInboxCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "skill") {
    process.exitCode = runSkillCommand(argv.slice(1));
    return;
  }
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  if (opts.help) {
    console.log(usage());
    return;
  }

  if (opts.version) {
    console.log(VERSION);
    return;
  }

  if (!opts.filePath) {
    console.error("Missing HTML file or folder.");
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  if (!existsSync(opts.filePath)) {
    console.error(`File not found: ${opts.filePath}`);
    process.exit(1);
  }
  const targetStat = statSync(opts.filePath);
  if (!targetStat.isFile() && !targetStat.isDirectory()) {
    console.error(`Not a file or folder: ${opts.filePath}`);
    process.exit(1);
  }

  const accessKey = opts.auth ? generateAccessKey() : null;
  const agentStatePath = (opts.agent || opts.agentSession) ? (opts.agentStatePath || defaultAgentStatePath(opts.filePath)) : null;
  const agentPromptOptions = (opts.agent || opts.agentSession) ? loadAgentPromptOptions(opts) : {};
  const instance = await createTunelitoServer({
    filePath: opts.filePath,
    commentsPath: opts.commentsPath,
    agentStatePath,
    host: opts.host,
    port: opts.port,
    accessKey,
    ownerName: opts.ownerName,
    liveMode: opts.live,
    blockedPaths: agentStatePath ? agentBlockedPaths(agentStatePath) : [],
  });
  const agentWorker = opts.agent
    ? createAgentWorker({
      provider: opts.agent,
      command: opts.agentCommand,
      commentsPath: instance.commentsPath,
      targetPath: opts.filePath,
      statePath: agentStatePath,
      intervalSeconds: opts.agentIntervalSeconds,
      policy: opts.agentPolicy,
      trigger: opts.agentTrigger,
      maxAttempts: opts.agentMaxAttempts,
      maxPasses: opts.agentMaxPasses,
      ownerName: opts.ownerName,
      promptAppend: agentPromptOptions.append,
      promptOverride: agentPromptOptions.override,
    })
    : null;
  const agentSessionRecordCommand = opts.agentSession ? inboxRecordCommand({
    targetPath: opts.filePath,
    commentsPath: instance.commentsPath,
    statePath: agentStatePath,
    maxPasses: opts.agentMaxPasses,
  }) : "";
  const agentSessionWatcher = opts.agentSession
    ? createAgentSessionWatcher({
      commentsPath: instance.commentsPath,
      targetPath: opts.filePath,
      statePath: agentStatePath,
      policy: opts.agentPolicy,
      trigger: opts.agentTrigger,
      maxAttempts: opts.agentMaxAttempts,
      maxPasses: opts.agentMaxPasses,
      ownerName: opts.ownerName,
      promptAppend: agentPromptOptions.append,
      recordCommand: agentSessionRecordCommand,
      log: (message) => console.log(message),
    })
    : null;

  let tunnel = null;
  let shuttingDown = false;

  instance.events.on("viewer-count", (count) => {
    console.log(`Viewers: ${count}`);
  });
  instance.events.on("comment", (comment) => {
    console.log(`Comment from ${comment.author}: ${comment.quote.slice(0, 80).replace(/\s+/g, " ")}`);
    agentWorker?.wake("comment");
    agentSessionWatcher?.wake("comment");
  });
  instance.events.on("document-changed", () => {
    console.log("HTML changed on disk; connected browsers were asked to reload.");
  });

  console.log("Tunelito is running");
  console.log(`Local:   ${instance.localUrl}`);
  console.log(opts.live ? "Comments: ephemeral (--live; not written to disk)" : `Comments: ${instance.commentsPath}`);
  if (opts.ownerName) {
    console.log(`Owner:   ${opts.ownerName}`);
  }
  if (agentWorker) {
    console.log(`Agent:   ${agentWorker.description}`);
    agentWorker.start();
  }
  if (opts.agentSession) {
    const sessionPath = writeAgentSessionFile({
      targetPath: opts.filePath,
      commentsPath: instance.commentsPath,
      statePath: agentStatePath,
      policy: opts.agentPolicy,
      trigger: opts.agentTrigger,
      maxAttempts: opts.agentMaxAttempts,
      maxPasses: opts.agentMaxPasses,
      ownerName: opts.ownerName,
      promptAppend: agentPromptOptions.append,
    });
    console.log(`Agent session: ${agentSessionWatcher.description}`);
    console.log(`Agent session: watching comments in this process`);
    console.log(`Agent session: tracker ${inboxStatusCommand({ targetPath: opts.filePath, commentsPath: instance.commentsPath, statePath: agentStatePath, policy: opts.agentPolicy, trigger: opts.agentTrigger })}`);
    console.log(`Agent session: record template ${agentSessionRecordCommand}`);
    console.log(`Agent session: metadata ${sessionPath}`);
    agentSessionWatcher.start();
  }
  if (opts.live) {
    console.log("Live:    WebRTC peer-to-peer when available; WebSocket relay fallback enabled");
  }
  console.log(opts.auth ? "Access:  review key required by the printed URLs" : "Access:  disabled (--no-auth)");

  if (opts.open) {
    openBrowser(instance.localUrl);
  }

  if (opts.tunnel) {
    console.log("Public:  starting Cloudflare Tunnel...");
    tunnel = startCloudflareTunnel({
      localUrl: instance.originUrl,
      onUrl(url) {
        console.log(`Public:  ${withReviewKey(url, accessKey)}`);
      },
      onFallback(fallbackPackage) {
        console.log(`Public:  cloudflared not found; trying npx ${fallbackPackage}...`);
      },
      onError(error) {
        console.log(`Public:  unavailable (${error.message})`);
        console.log("         Install cloudflared, allow npm/npx network access, or rerun with --no-tunnel.");
      },
    });
  } else {
    console.log("Public:  disabled (--no-tunnel)");
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down Tunelito...");
    if (tunnel) tunnel.stop();
    await agentWorker?.stop();
    await agentSessionWatcher?.stop();
    await instance.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function doctorUsage() {
  return `Tunelito doctor -- read-only local setup and safety diagnostics.

Usage:
  tunelito doctor [page.html|folder] [options]

Options:
  --out <path>              Markdown comments file to inspect
  --agent-state <path>      Agent resolution ledger to inspect
  --host <host>             Host to evaluate (default: 127.0.0.1)
  --port <number>           Port to evaluate (default: 4317)
  --no-auth                 Evaluate an unauthenticated session shape
  --no-tunnel               Evaluate a local-only session shape
  --live                    Evaluate live-mode persistence
  --agent <codex|claude|custom>
                            Evaluate local agent worker compatibility
  --agent-session           Evaluate active-agent session compatibility
  --agent-policy <mode>     Which comments are actionable: ${AGENT_POLICIES.join("|")} (default: ${DEFAULT_AGENT_POLICY})
  --agent-trigger <txt>     Marker for mention policies, or "all" (default: ${DEFAULT_AGENT_TRIGGER})
  --json                    Print the machine-readable tunelito-doctor report
`;
}

export function parseDoctorArgs(argv) {
  const opts = {
    host: "127.0.0.1",
    port: 4317,
    auth: true,
    tunnel: true,
    agentPolicy: DEFAULT_AGENT_POLICY,
    agentTrigger: DEFAULT_AGENT_TRIGGER,
    format: "text",
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help" || arg === "help") {
      opts.help = true;
    } else if (arg === "--out") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--out"));
    } else if (arg === "--agent-state") {
      opts.agentStatePath = resolve(requiredValue(argv[++i], "--agent-state"));
    } else if (arg === "--host") {
      opts.host = requiredValue(argv[++i], "--host");
    } else if (arg === "--port") {
      opts.port = parseIntegerValue(argv[++i], "--port", { min: 0, max: 65535 });
    } else if (arg === "--no-auth") {
      opts.auth = false;
    } else if (arg === "--no-tunnel") {
      opts.tunnel = false;
    } else if (arg === "--live") {
      opts.live = true;
    } else if (arg === "--agent") {
      opts.agent = requiredValue(argv[++i], "--agent", "provider: codex, claude, or custom").toLowerCase();
    } else if (arg === "--agent-session") {
      opts.agentSession = true;
    } else if (arg === "--agent-policy") {
      opts.agentPolicy = normalizeAgentPolicy(requiredValue(argv[++i], "--agent-policy"));
      opts.agentPolicyProvided = true;
    } else if (arg === "--agent-trigger") {
      opts.agentTrigger = requiredValue(argv[++i], "--agent-trigger");
    } else if (arg === "--json") {
      opts.format = "json";
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown doctor option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(`Expected zero or one HTML file or folder, got ${positional.length}`);
  }
  if (opts.agent && !["codex", "claude", "custom"].includes(opts.agent)) {
    throw new Error(`Unsupported --agent provider: ${opts.agent}`);
  }
  validateMentionAgentPolicy(opts.agentPolicy, opts.agentTrigger);
  if (positional[0]) opts.targetPath = resolve(positional[0]);
  return opts;
}

export async function runDoctorCommand(args, { stdout = process.stdout, stderr = process.stderr, deps = {} } = {}) {
  let opts;
  try {
    opts = parseDoctorArgs(args);
  } catch (error) {
    stderr.write(`${error.message}\n\n${doctorUsage()}`);
    return 1;
  }

  if (opts.help) {
    stdout.write(doctorUsage());
    return 0;
  }

  const report = await buildDoctorReport(opts, deps);
  stdout.write(formatDoctorReport(report, opts.format));
  return report.ok ? 0 : 1;
}

function formatDoctorReport(report, format) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    "Tunelito doctor",
    `Status: ${report.ok ? "ok" : "error"}`,
    `Errors: ${report.summary.errors}`,
    `Warnings: ${report.summary.warnings}`,
    `Info: ${report.summary.info}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.id}: ${check.message}`);
  }
  lines.push("");
  return lines.join("\n");
}

function mcpUsage() {
  return `Tunelito MCP -- stdio Model Context Protocol server.

Usage:
  tunelito mcp

The MCP server exposes comments and active-agent inbox tools. It does not start
a review server, tunnel, browser, or local agent worker.
`;
}

export function runMcpCommand(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const sub = args[0];
  if (sub === "help" || sub === "-h" || sub === "--help") {
    stdout.write(mcpUsage());
    return 0;
  }
  if (args.length) {
    stderr.write(`Unknown mcp argument: ${sub}\n\n${mcpUsage()}`);
    return 1;
  }
  createMcpServer({ stdin, stdout, stderr });
  return 0;
}

function commentsUsage() {
  return `Tunelito comments -- structured comments inbox tools.

Usage:
  tunelito comments inspect <page.html|folder|comments.md> [options]

Commands:
  inspect     Print an index for a Tunelito comments inbox
  help        Show this message

Options:
  --out <path>    Markdown comments file for a page or folder target
  --json          Print the machine-readable tunelito-comments index
`;
}

export function parseCommentsArgs(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { help: true };
  }
  if (command !== "inspect") {
    throw new Error(`Unknown comments command: ${command}`);
  }

  const opts = { command, format: "text" };
  const positional = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--out") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--out"));
    } else if (arg === "--json") {
      opts.format = "json";
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown comments option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1 && !opts.help) {
    throw new Error(`Expected one page, folder, or comments file, got ${positional.length}`);
  }

  if (positional[0]) {
    const inputPath = resolve(positional[0]);
    const inputLooksLikeMarkdown = /\.md$/i.test(positional[0]);
    if (opts.commentsPath && inputLooksLikeMarkdown) {
      throw new Error("--out is only supported when inspecting a page or folder target");
    }
    if (!opts.commentsPath && inputLooksLikeMarkdown) {
      opts.commentsPath = inputPath;
      opts.requireCommentsFile = true;
    } else {
      opts.targetPath = inputPath;
    }
  }

  return opts;
}

export function runCommentsCommand(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseCommentsArgs(args);
  } catch (error) {
    stderr.write(`${error.message}\n\n${commentsUsage()}`);
    return 1;
  }

  if (opts.help) {
    stdout.write(commentsUsage());
    return 0;
  }

  const index = buildCommentsIndex({
    targetPath: opts.targetPath,
    commentsPath: opts.commentsPath,
    requireCommentsFile: opts.requireCommentsFile,
  });
  stdout.write(formatCommentsIndex(index, opts.format));
  return index.ok ? 0 : 1;
}

function formatCommentsIndex(index, format) {
  if (format === "json") return `${JSON.stringify(index, null, 2)}\n`;
  const diagnostics = index.diagnostics.length
    ? `\nDiagnostics:\n${index.diagnostics.map((item) => `- ${item.severity}: ${item.message}`).join("\n")}\n`
    : "";
  return [
    "Tunelito comments index",
    `Status:   ${index.ok ? "ok" : "error"}`,
    `Target:   ${index.targetPath || "(not provided)"}`,
    `Comments: ${index.commentsPath || "(not provided)"}`,
    `Total:    ${index.summary.total}`,
    `Page:     ${index.summary.page}`,
    `Site:     ${index.summary.site}`,
    `Owner:    ${index.summary.owner}`,
    `Visitor:  ${index.summary.visitor}`,
    `Approved: ${index.summary.ownerApproved}`,
    diagnostics,
  ].join("\n");
}

function inboxUsage() {
  return `Tunelito inbox -- active-agent comment inbox commands.

Usage:
  tunelito inbox next <page.html|folder> [options]
  tunelito inbox watch <page.html|folder> [options]
  tunelito inbox status <page.html|folder> [options]
  tunelito inbox record <page.html|folder> --id <id> --status <status> [options]

Commands:
  next        Claim pending comments and print a prompt for the current agent
  watch       Wait for the next pending comment, claim it, then print a prompt
  status      Print a live to-do tracker from the comments inbox and ledger
  record      Record the current agent's result in .tunelito/agent/state.json
  help        Show this message

Options for next/watch/status:
  --out <path>              Markdown comments file (default: <page-or-folder>.comments.md)
  --agent-state <path>      Agent resolution ledger (default: <target>/.tunelito/agent/state.json)
  --agent-policy <mode>     Which comments are actionable: ${AGENT_POLICIES.join("|")} (default: ${DEFAULT_AGENT_POLICY})
  --agent-trigger <txt>     Marker for mention policies, or "all" (default: ${DEFAULT_AGENT_TRIGGER})
  --agent-instructions <txt>
                            Append host instructions to the active-agent prompt
  --agent-instructions-file <path>
                            Append host instructions from a file
  --agent-max-attempts <n>  Stop retrying a comment after n attempts (default: ${DEFAULT_AGENT_MAX_ATTEMPTS})
  --agent-max-passes <n>    Stop continuing a multi-pass comment after n passes (default: ${DEFAULT_AGENT_MAX_PASSES})
  --limit <n>               Number of comments to claim at once (default: 1)
  --claim-owner <name>      Label for the active agent claim (default: agent-session)
  --claim-ttl <s>           Claim lease in seconds (default: ${DEFAULT_INBOX_CLAIM_SECONDS})
  --wait                    Wait until an actionable comment exists
  --wait-interval <s>       Fallback polling interval while waiting (default: ${DEFAULT_INBOX_WAIT_INTERVAL_SECONDS})
  --timeout <s>             Stop waiting after this many seconds (default: 0, no timeout)
  --format <prompt|json|ids>
                            Output format for next/watch (default: prompt)
  --format <text|json>      Output format for status (default: text)

Options for record:
  --out <path>              Markdown comments file (default: <page-or-folder>.comments.md)
  --agent-state <path>      Agent resolution ledger (default: <target>/.tunelito/agent/state.json)
  --id <id>                 Comment id to record
  --claim <id>              Active claim id from inbox next/watch
  --status <status>         resolved|no-op|blocked|stale|ignored|partial|needs_followup
  --summary <txt>           Short result summary
  --file <path>             Changed file; repeat for multiple files
  --completed <txt>         Completed task; repeat for multiple tasks
  --remaining <txt>         Remaining task; repeat for needs_followup
  --agent-max-passes <n>    Pass limit used for needs_followup records (default: ${DEFAULT_AGENT_MAX_PASSES})
  --format <text|json>      Output format for record (default: text)
`;
}

export function parseInboxArgs(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { help: true };
  }
  if (!["next", "watch", "status", "record"].includes(command)) {
    throw new Error(`Unknown inbox command: ${command}`);
  }

  const opts = {
    command,
    wait: command === "watch",
    agentPolicy: DEFAULT_AGENT_POLICY,
    agentTrigger: DEFAULT_AGENT_TRIGGER,
    agentMaxAttempts: DEFAULT_AGENT_MAX_ATTEMPTS,
    agentMaxPasses: DEFAULT_AGENT_MAX_PASSES,
    limit: 1,
    claimOwner: "agent-session",
    claimTtlSeconds: DEFAULT_INBOX_CLAIM_SECONDS,
    waitIntervalSeconds: DEFAULT_INBOX_WAIT_INTERVAL_SECONDS,
    timeoutSeconds: 0,
    format: command === "record" || command === "status" ? "text" : "prompt",
    filesChanged: [],
    completedTasks: [],
    remainingTasks: [],
  };
  const positional = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--out") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--out"));
    } else if (arg === "--agent-state") {
      opts.agentStatePath = resolve(requiredValue(argv[++i], "--agent-state"));
    } else if (arg === "--agent-policy") {
      opts.agentPolicy = normalizeAgentPolicy(requiredValue(argv[++i], "--agent-policy"));
    } else if (arg === "--agent-trigger") {
      opts.agentTrigger = requiredValue(argv[++i], "--agent-trigger");
    } else if (arg === "--agent-instructions") {
      opts.agentInstructions = requiredValue(argv[++i], "--agent-instructions");
    } else if (arg === "--agent-instructions-file") {
      opts.agentInstructionsPath = resolve(requiredValue(argv[++i], "--agent-instructions-file"));
    } else if (arg === "--agent-max-attempts") {
      opts.agentMaxAttempts = parseIntegerValue(argv[++i], "--agent-max-attempts", { min: 1 });
    } else if (arg === "--agent-max-passes") {
      opts.agentMaxPasses = parseIntegerValue(argv[++i], "--agent-max-passes", { min: 1 });
    } else if (arg === "--limit") {
      opts.limit = parseIntegerValue(argv[++i], "--limit", { min: 1 });
    } else if (arg === "--claim-owner") {
      opts.claimOwner = requiredName(argv[++i], "--claim-owner");
    } else if (arg === "--claim-ttl") {
      opts.claimTtlSeconds = parseIntegerValue(argv[++i], "--claim-ttl", { min: 1 });
    } else if (arg === "--wait") {
      opts.wait = true;
    } else if (arg === "--wait-interval") {
      opts.waitIntervalSeconds = parseIntegerValue(argv[++i], "--wait-interval", { min: 1 });
    } else if (arg === "--timeout") {
      opts.timeoutSeconds = parseIntegerValue(argv[++i], "--timeout", { min: 0 });
    } else if (arg === "--format") {
      opts.format = requiredValue(argv[++i], "--format");
    } else if (arg === "--id") {
      opts.id = requiredValue(argv[++i], "--id");
    } else if (arg === "--claim") {
      if (command !== "record") throw new Error("--claim is only supported by inbox record");
      opts.claimId = requiredValue(argv[++i], "--claim");
    } else if (arg === "--status") {
      opts.status = requiredValue(argv[++i], "--status");
    } else if (arg === "--summary") {
      opts.summary = requiredValue(argv[++i], "--summary");
    } else if (arg === "--file") {
      opts.filesChanged.push(requiredValue(argv[++i], "--file"));
    } else if (arg === "--completed") {
      opts.completedTasks.push(requiredValue(argv[++i], "--completed"));
    } else if (arg === "--remaining") {
      opts.remainingTasks.push(requiredValue(argv[++i], "--remaining"));
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown inbox option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1 && !opts.help) {
    throw new Error(`Expected one HTML file or folder, got ${positional.length}`);
  }
  if (opts.agentInstructions && opts.agentInstructionsPath) {
    throw new Error("Use either --agent-instructions or --agent-instructions-file, not both");
  }
  validateMentionAgentPolicy(opts.agentPolicy, opts.agentTrigger);
  if (command === "record" && !opts.help) {
    if (!opts.id) throw new Error("inbox record requires --id");
    if (!opts.status) throw new Error("inbox record requires --status");
    if (!["text", "json"].includes(opts.format)) throw new Error("Unsupported --format for inbox record: use text or json");
  } else if (command === "status" && !opts.help) {
    if (!["text", "json"].includes(opts.format)) throw new Error("Unsupported --format for inbox status: use text or json");
  } else if (!opts.help) {
    if (!["prompt", "json", "ids"].includes(opts.format)) throw new Error("Unsupported --format for inbox next/watch: use prompt, json, or ids");
  }
  if (positional[0]) opts.filePath = resolve(positional[0]);
  return opts;
}

export async function runInboxCommand(args, { stdout = process.stdout, stderr = process.stderr, now = () => new Date(), log = console.log } = {}) {
  let opts;
  try {
    opts = parseInboxArgs(args);
  } catch (error) {
    stderr.write(`${error.message}\n\n${inboxUsage()}`);
    return 1;
  }

  if (opts.help) {
    stdout.write(inboxUsage());
    return 0;
  }

  try {
    const paths = resolveInboxPaths(opts);
    if (opts.command === "status") {
      const tracker = formatAgentTodoTracker({
        commentsPath: paths.commentsPath,
        targetPath: paths.filePath,
        statePath: paths.statePath,
        trigger: opts.agentTrigger,
        policy: opts.agentPolicy,
        now,
      });
      stdout.write(formatInboxStatusResult(tracker, opts.format, paths));
      return 0;
    }
    if (opts.command === "record") {
      const recorded = recordAgentSessionResult({
        commentsPath: paths.commentsPath,
        targetPath: paths.filePath,
        statePath: paths.statePath,
        maxPasses: opts.agentMaxPasses,
        claimId: opts.claimId || "",
        now,
        result: {
          id: opts.id,
          status: opts.status,
          summary: opts.summary || "",
          filesChanged: opts.filesChanged,
          completedTasks: opts.completedTasks,
          remainingTasks: opts.remainingTasks,
        },
      });
      stdout.write(formatInboxRecordResult(recorded, opts.format, {
        trigger: opts.agentTrigger,
        policy: opts.agentPolicy,
        now,
      }));
      return 0;
    }

    const promptAppend = opts.agentInstructionsPath ? readFileSync(opts.agentInstructionsPath, "utf8") : opts.agentInstructions || "";
    const recordCommand = inboxRecordCommand({
      targetPath: paths.filePath,
      commentsPath: paths.commentsPath,
      statePath: paths.statePath,
      maxPasses: opts.agentMaxPasses,
    });
    const claimOptions = {
      commentsPath: paths.commentsPath,
      targetPath: paths.filePath,
      statePath: paths.statePath,
      trigger: opts.agentTrigger,
      policy: opts.agentPolicy,
      maxAttempts: opts.agentMaxAttempts,
      maxPasses: opts.agentMaxPasses,
      promptAppend,
      claimOwner: opts.claimOwner,
      claimSeconds: opts.claimTtlSeconds,
      limit: opts.limit,
      recordCommand,
      now,
    };
    const result = opts.wait
      ? await waitForAgentInboxComments({
        ...claimOptions,
        waitIntervalSeconds: opts.waitIntervalSeconds,
        timeoutSeconds: opts.timeoutSeconds,
        log,
      })
      : claimNextAgentComments(claimOptions);
    stdout.write(formatInboxClaimResult(result, opts.format));
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

function resolveInboxPaths(opts) {
  if (!existsSync(opts.filePath)) throw new Error(`File not found: ${opts.filePath}`);
  const targetStat = statSync(opts.filePath);
  if (!targetStat.isFile() && !targetStat.isDirectory()) throw new Error(`Not a file or folder: ${opts.filePath}`);
  const commentsPath = resolve(opts.commentsPath || defaultCommentsPath(opts.filePath));
  const statePath = resolve(opts.agentStatePath || defaultAgentStatePath(opts.filePath));
  return {
    filePath: opts.filePath,
    commentsPath,
    statePath,
  };
}

function formatInboxStatusResult(tracker, format, paths) {
  if (format === "json") {
    return `${JSON.stringify({
      commentsPath: paths.commentsPath,
      statePath: paths.statePath,
      tracker,
    }, null, 2)}\n`;
  }
  return tracker;
}

function formatInboxClaimResult(result, format) {
  if (format === "json") {
    return `${JSON.stringify({
      status: result.comments.length ? "claimed" : "empty",
      reason: result.reason,
      commentsPath: result.commentsPath,
      statePath: result.statePath,
      workspaceRoot: result.workspaceRoot,
      claim: result.claim || null,
      comments: result.comments,
      prompt: result.prompt,
    }, null, 2)}\n`;
  }
  if (format === "ids") {
    return result.comments.length ? `${result.comments.map((comment) => comment.id).join("\n")}\n` : "";
  }
  return result.comments.length ? result.prompt : `No pending Tunelito comments (${result.reason}).\n`;
}

function formatInboxRecordResult(recorded, format, { trigger = DEFAULT_AGENT_TRIGGER, policy = DEFAULT_AGENT_POLICY, now = () => new Date() } = {}) {
  if (format === "json") {
    return `${JSON.stringify({
      id: recorded.comment.id,
      status: recorded.state.status,
      summary: recorded.state.summary || "",
      filesChanged: recorded.state.filesChanged || [],
      completedTasks: recorded.state.completedTasks || [],
      remainingTasks: recorded.state.remainingTasks || [],
      statePath: recorded.statePath,
    }, null, 2)}\n`;
  }
  const tracker = formatAgentTodoTracker({
    commentsPath: recorded.commentsPath,
    targetPath: recorded.targetPath,
    statePath: recorded.statePath,
    trigger,
    policy,
    now,
  });
  return `Recorded ${recorded.comment.id} as ${recorded.state.status} in ${recorded.statePath}\n\n${tracker}`;
}

function writeAgentSessionFile({ targetPath, commentsPath, statePath, policy, trigger, maxAttempts, maxPasses, ownerName, promptAppend }) {
  const workspaceRoot = agentWorkspaceRoot(targetPath);
  const sessionPath = join(workspaceRoot, ".tunelito", "session.json");
  mkdirSync(dirname(sessionPath), { recursive: true });
  const session = {
    version: 1,
    mode: "agent-session",
    targetPath,
    workspaceRoot,
    commentsPath,
    statePath,
    policy,
    trigger,
    maxAttempts,
    maxPasses,
    ownerName: ownerName || "",
    hasInstructions: Boolean(promptAppend),
    nextCommand: inboxWatchCommand({ targetPath, commentsPath, statePath, policy, trigger, maxAttempts, maxPasses }),
    statusCommand: inboxStatusCommand({ targetPath, commentsPath, statePath, policy, trigger }),
    recordCommand: inboxRecordCommand({ targetPath, commentsPath, statePath, maxPasses }),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return sessionPath;
}

function inboxWatchCommand({ targetPath, commentsPath, statePath, policy, trigger, maxAttempts, maxPasses }) {
  return [
    "tunelito",
    "inbox",
    "watch",
    shellQuote(targetPath),
    "--out",
    shellQuote(commentsPath),
    "--agent-state",
    shellQuote(statePath),
    "--agent-policy",
    shellQuote(policy),
    "--agent-trigger",
    shellQuote(trigger),
    "--agent-max-attempts",
    String(maxAttempts),
    "--agent-max-passes",
    String(maxPasses),
  ].join(" ");
}

function inboxRecordCommand({ targetPath, commentsPath, statePath, maxPasses }) {
  return [
    "tunelito",
    "inbox",
    "record",
    shellQuote(targetPath),
    "--out",
    shellQuote(commentsPath),
    "--agent-state",
    shellQuote(statePath),
    "--agent-max-passes",
    String(maxPasses),
    "--id <comment-id>",
    "--status <status>",
    "--summary \"<short summary>\"",
    "--file <relative/path.html>",
  ].join(" ");
}

function inboxStatusCommand({ targetPath, commentsPath, statePath, policy, trigger }) {
  return [
    "tunelito",
    "inbox",
    "status",
    shellQuote(targetPath),
    "--out",
    shellQuote(commentsPath),
    "--agent-state",
    shellQuote(statePath),
    "--agent-policy",
    shellQuote(policy),
    "--agent-trigger",
    shellQuote(trigger),
  ].join(" ");
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function openBrowser(url, { platform = process.platform, spawnFn = spawn, log = console.log } = {}) {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawnFn(command, args, { stdio: "ignore", detached: true });
  child.on("error", (error) => {
    log(`Open:    could not launch browser (${error.message})`);
  });
  child.unref();
  return child;
}

export function generateAccessKey(randomFn = randomBytes) {
  return randomFn(18).toString("base64url");
}

export function withReviewKey(url, accessKey) {
  const parsed = new URL(url);
  if (accessKey) parsed.searchParams.set("tunelito_key", accessKey);
  return parsed.toString();
}

export function isCliEntry(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  const directPath = pathToFileURL(argvPath).href;
  let realPath = directPath;
  try {
    realPath = pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    // If argvPath cannot be resolved, the direct comparison is still useful.
  }
  return metaUrl === directPath || metaUrl === realPath;
}

export function agentBlockedPaths(statePath) {
  const logPath = defaultAgentLogPath(statePath);
  return [statePath, `${statePath}.tmp`, logPath];
}

export function loadAgentPromptOptions(opts) {
  return {
    append: opts.agentInstructionsPath ? readFileSync(opts.agentInstructionsPath, "utf8") : opts.agentInstructions || "",
    override: opts.agentPromptPath ? readFileSync(opts.agentPromptPath, "utf8") : opts.agentPrompt || "",
  };
}

export function readBundledSkill() {
  return readFileSync(new URL("../docs-site/skill.md", import.meta.url), "utf8");
}

function skillUsage() {
  return `Tunelito skill -- the distributable agent skill for coding agents.

Usage: tunelito skill <command>

Commands:
  show        Print the Tunelito agent skill (SKILL.md) to stdout
  help        Show this message

Install it for your coding agent, for example with Claude Code:
  tunelito skill show > .claude/skills/tunelito/SKILL.md

Or just ask your agent: "run 'npx --yes tunelito skill show' and install the skill it prints."
`;
}

export function runSkillCommand(args, { stdout = process.stdout, stderr = process.stderr, readSkill = readBundledSkill } = {}) {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
    stdout.write(skillUsage());
    return 0;
  }
  if (sub === "show") {
    let content;
    try {
      content = readSkill();
    } catch (error) {
      stderr.write(`Could not read the bundled Tunelito skill: ${error.message}\n`);
      return 1;
    }
    stdout.write(content.endsWith("\n") ? content : `${content}\n`);
    return 0;
  }
  stderr.write(`Unknown skill command: ${sub}\n\n`);
  stderr.write(skillUsage());
  return 1;
}

if (isCliEntry(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
