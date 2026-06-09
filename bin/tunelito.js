#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  AGENT_POLICIES,
  DEFAULT_AGENT_INTERVAL_SECONDS,
  DEFAULT_AGENT_MAX_ATTEMPTS,
  DEFAULT_AGENT_MAX_PASSES,
  DEFAULT_AGENT_POLICY,
  DEFAULT_AGENT_TRIGGER,
  defaultAgentLogPath,
  createAgentWorker,
  defaultAgentStatePath,
  normalizeAgentPolicy,
} from "../src/agent-worker.js";
import { createTunelitoServer } from "../src/server.js";
import { startCloudflareTunnel } from "../src/tunnel.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = pkg.version;

function usage() {
  return `Tunelito ${VERSION}

Usage: tunelito <page.html|folder> [options]
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
  --agent-policy <mode> Which comments the agent handles: ${AGENT_POLICIES.join("|")} (default: ${DEFAULT_AGENT_POLICY})
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
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --no-auth             Disable the generated review-key URL gate
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show this help

Commands:
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
    } else if (arg === "--agent-command") {
      const value = requiredValue(argv[++i], "--agent-command");
      opts.agentCommand = value;
      if (!opts.agent) opts.agent = "custom";
    } else if (arg === "--agent-interval") {
      const value = argv[++i];
      opts.agentIntervalSeconds = parseIntegerValue(value, "--agent-interval", { min: 1 });
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
  if ((opts.agentInstructions || opts.agentInstructionsPath || opts.agentPrompt || opts.agentPromptPath) && !opts.agent) {
    throw new Error("--agent prompt options require --agent or --agent-command");
  }
  if (opts.agentPolicy !== DEFAULT_AGENT_POLICY && !opts.agent) {
    throw new Error("--agent-policy requires --agent or --agent-command");
  }
  if (["mention", "owner-or-mention"].includes(opts.agentPolicy) && isAllAgentTrigger(opts.agentTrigger)) {
    throw new Error(`--agent-policy ${opts.agentPolicy} requires --agent-trigger with a marker such as @agent`);
  }
  if (opts.agentInstructions && opts.agentInstructionsPath) {
    throw new Error("Use either --agent-instructions or --agent-instructions-file, not both");
  }
  if (opts.agentPrompt && opts.agentPromptPath) {
    throw new Error("Use either --agent-prompt or --agent-prompt-file, not both");
  }
  if (opts.live && opts.agent) {
    throw new Error("--agent requires persistent comments; remove --live");
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

async function main() {
  const argv = process.argv.slice(2);
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
  const agentStatePath = opts.agent ? (opts.agentStatePath || defaultAgentStatePath(opts.filePath)) : null;
  const agentPromptOptions = opts.agent ? loadAgentPromptOptions(opts) : {};
  const instance = await createTunelitoServer({
    filePath: opts.filePath,
    commentsPath: opts.commentsPath,
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

  let tunnel = null;
  let shuttingDown = false;

  instance.events.on("viewer-count", (count) => {
    console.log(`Viewers: ${count}`);
  });
  instance.events.on("comment", (comment) => {
    console.log(`Comment from ${comment.author}: ${comment.quote.slice(0, 80).replace(/\s+/g, " ")}`);
    agentWorker?.wake("comment");
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
    await instance.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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

Or just ask your agent: "run 'tunelito skill show' and install the skill it prints."
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
