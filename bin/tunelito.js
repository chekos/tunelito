#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
import { resolveTunelitoConfig } from "../src/config.js";
import { enforceLinkPreviewHeaderPolicy, enforceLinkPreviewHostPolicy, parseLinkPreviewFieldsArg } from "../src/link-preview.js";
import { isValidEnvName, parseLinkPreviewHeaderArg } from "../src/link-preview-headers.js";
import { buildDoctorReport } from "../src/doctor.js";
import { REVIEW_EVENTS_ROUTE } from "../src/inject.js";
import { isMarkdownPath, normalizeMarkdownCssHref } from "../src/markdown.js";
import { createMcpServer } from "../src/mcp.js";
import { createTunelitoServer } from "../src/server.js";
import {
  SESSION_FORMAT,
  SESSION_VERSION,
  formatSessionStatus,
  inspectSession,
  sessionPathForTarget,
  updateSessionFile,
  writeSessionFile,
} from "../src/session.js";
import { startCloudflareTunnel } from "../src/tunnel.js";
import {
  UsageError,
  closestMatch,
  createStyle,
  createTerminalWriter,
  displayPath,
  formatCliError,
  formatDuration,
  formatEvent,
  formatRows,
  plainStyle,
  plural,
  suggestSiblingPath,
  truncate,
  terminalText,
} from "../src/cli-output.js";
import { GLOBAL_OPTIONS, inspectGlobals, normalizeArguments, optionMetadata, routeCommand } from "../src/cli-options.js";
import { createShutdownHandler, forceOwnedChildren } from "../src/process-lifecycle.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = pkg.version;

// Help is layered: `--help` shows what a person needs to start a review in
// one screen; `help <topic>` holds the depth; `help all` is the full list.
export function usage() {
  return `Usage:
  tunelito <page.html|notes.md|folder> [options]
  tunelito <command> [options]

Turn a local HTML or Markdown file, or a folder, into a live review room.

Examples:
  tunelito ./page.html                    Share a page on a call; send the Public link
  tunelito ./notes.md --editable --open   Review a memo and edit it from your browser
  tunelito ./site --no-tunnel             Keep the room on this machine
  tunelito ./site --agent-session         Let this coding-agent conversation handle comments

Options:
${HELP_CORE_OPTIONS}
Commands:
${HELP_COMMANDS}
More help:
  tunelito help agent          Agent worker and agent-session options
  tunelito help markdown       Themes, CSS, code wrap, section index, editing
  tunelito help link-preview   Resolver-backed Markdown link previews
  tunelito help network        Port, host, tunnel, and access options
  tunelito help json           The --json event stream for scripts and agents
  tunelito help all            Every option
  tunelito <command> --help    Options for one command
`;
}

const HELP_CORE_OPTIONS = `  --no-tunnel           Keep the room on this machine; no public link
  --open                Open the Local URL in your default browser
  --editable            Edit Markdown source from the Local URL (shared links stay read-only)
  --ephemeral           Keep comments in memory only; they are lost when Tunelito stops
  --comments <path>     Markdown comments file (default: <page-or-folder>.comments.md)
  --agent <codex|claude|custom>
                        Run a local coding-agent worker on new comments
  --agent-session       Let the current coding-agent conversation handle comments
  --json                Print startup and runtime events as JSON lines (for scripts and agents)
  --verbose             Also print theme, session metadata, and handoff rows at startup
  --format <text|json|plain>
                        Select human text, machine JSONL, or accessible plain output
  --no-color            Disable color, including FORCE_COLOR
  --plain               Disable color and terminal redraws (accessible presentation)
  -v, --version         Show version
  -h, --help            Show this help
`;

const HELP_COMMANDS = `  doctor                Check local setup and sharing safety (read-only)
  session status        Inspect or recover the last session for a target
  inbox                 Claim, track, and record comments for an active agent
  comments inspect      Print a structured index of a comments file
  review watch          Wait for a reviewer's Done Reviewing handoff
  config show           Print resolved Markdown settings and where they came from
  skill                 Print, explain, or install the Tunelito agent skill
  mcp                   Start a stdio MCP server for comments and inbox tools
`;

const HELP_NETWORK = `Network and access:
  --port <number>       First port to try; Tunelito moves up to the next free one (default: 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --no-tunnel           Only serve the Local URL; do not start Cloudflare Tunnel
  --no-auth             Drop the review key; anyone with a link can view and comment
`;

const HELP_MARKDOWN = `Markdown presentation:
  --theme <name>        Markdown theme: default|editorial|technical|bns-pitaya
  --markdown-css <href> Add a stylesheet link to rendered Markdown pages
  --no-code-wrap        Scroll long lines in Markdown code blocks instead of wrapping
                        them (--code-wrap restores the wrapping default)
  --code-wrap           Wrap long Markdown code lines (default)
  --editable            Let the direct local owner edit safely served Markdown
  --section-index       Show a sticky Markdown section index on wide viewports
  --owner <name>        Seed the editable owner name for the direct local viewer

Project defaults live in tunelito.config.json; run \`tunelito config show <target>\`
to see the resolved values and where each came from.
`;

const HELP_LINK_PREVIEW = `Link previews (Markdown):
  --link-preview <regex> <url-template>
                        Show a Markdown hover card for links matching regex, filled from
                        resolver JSON fetched by the Tunelito server (repeatable)
  --link-preview-fields <title=path,status=path,priority=path>
                        JSON paths for the preceding --link-preview rule
  --link-preview-header '<Name>: <value>'
                        Add a request header to the preceding --link-preview rule; read secrets
                        with \${env:NAME} (single-quote it; repeatable, owner-only)
  --link-preview-env <NAME>
                        Allow resolver headers to read this environment variable; required
                        for any resolver header, CLI only (repeatable)
  --link-preview-allow-remote
                        Allow https resolvers on non-loopback hosts (default: loopback only)
  --link-preview-visitors
                        Also resolve previews for keyed public visitors (default: owner only)
`;

const HELP_AGENT = `Agents:
  Before serving from a coding agent, load the bundled workflow: tunelito skill show
  Installation guidance: tunelito skill setup
  --agent-session       Watch comments for the current agent session; do not spawn a worker
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

--agent-session and --agent both need persistent comments, so neither works
with --ephemeral. Run \`tunelito skill show\` for the full agent workflow.
`;

const HELP_JSON = `JSON event stream (--json):
  stdout carries one JSON object per line instead of the human startup block.
  Every event has "type" and "time". Types, in order of appearance:
    started    version, target, localUrl, commentsPath, sessionPath, tunnel, auth,
               ephemeral, editable, theme, agent, commands (handoff, tracker, record)
    tunnel     state: starting|fallback|dns-wait|ready|unavailable|disabled,
               plus publicUrl (ready), hostname/code (dns-wait), error (unavailable)
    viewers    count
    comment    id, author, authorRole, scope, pagePath, body
    reload     a source file changed and browsers were asked to reload
    review     sequence, comments (a reviewer pressed Done Reviewing)
    agent      message (single-line agent worker or inbox note)
    prompt     text (multi-line agent-session claim prompt)
    warning    message (session metadata or browser-open problems)
    stopped    elapsedMs, newComments, signal, exitCode, cleanup
  CLI contract v2: errors are single tunelito-error JSON objects on stderr,
  with schemaVersion, code, message, recovery; usage exits 2, runtime exits 1.
  SIGINT/SIGTERM/SIGHUP exit 130/143/129. stdout events already emitted remain.
`;

export const HELP_TOPICS = {
  agent: () => HELP_AGENT,
  markdown: () => HELP_MARKDOWN,
  "link-preview": () => HELP_LINK_PREVIEW,
  network: () => HELP_NETWORK,
  json: () => HELP_JSON,
  all: () => [
    `Tunelito ${VERSION}\n\nUsage:\n  tunelito <page.html|notes.md|folder> [options]\n\nCore:\n${HELP_CORE_OPTIONS}`,
    HELP_NETWORK,
    HELP_MARKDOWN,
    HELP_LINK_PREVIEW,
    HELP_AGENT,
    HELP_JSON,
    `Commands:\n${HELP_COMMANDS}`,
  ].join("\n"),
};

export function helpTopic(name) {
  if (!name) return usage();
  const topic = HELP_TOPICS[name];
  if (topic) return topic();
  const commandHelp = { doctor: doctorUsage, session: sessionUsage, inbox: inboxUsage, comments: commentsUsage, review: reviewUsage, config: configUsage, skill: skillUsage, mcp: mcpUsage }[name];
  if (commandHelp) return commandHelp();
  const suggestion = closestMatch(name, [...Object.keys(HELP_TOPICS), "doctor", "session", "inbox", "comments", "review", "config", "skill", "mcp"]);
  throw new UsageError(`No help topic named ${name}`, {
    hint: suggestion ? `Did you mean tunelito help ${suggestion}?` : `Topics: ${Object.keys(HELP_TOPICS).join(", ")}.`,
  });
}

function parseServeOptions(argv) {
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
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "--format") {
      const value = requiredValue(argv[++i], "--format");
      if (!["text", "json", "plain"].includes(value)) throw new UsageError("--format must be text, json, or plain");
      opts.json = value === "json";
      opts.plain = value === "plain";
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "-v" || arg === "--version") {
      opts.version = true;
    } else if (arg === "--no-tunnel") {
      opts.tunnel = false;
    } else if (arg === "--ephemeral") {
      opts.ephemeral = true;
      opts.live = true;
    } else if (arg === "--json") {
      opts.json = true;
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
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "--port") {
      const value = argv[++i];
      opts.port = parseIntegerValue(value, "--port", { min: 0, max: 65535 });
    } else if (arg === "--host") {
      opts.host = requiredValue(argv[++i], "--host");
    } else if (arg === "--comments") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--comments", "path"));
    } else if (arg === "--theme") {
      opts.theme = requiredValue(argv[++i], "--theme", "theme name");
      opts.themeProvided = true;
    } else if (arg === "--markdown-css") {
      opts.markdownCssHref = normalizeMarkdownCssHref(requiredValue(argv[++i], "--markdown-css"));
      opts.markdownCssProvided = true;
    } else if (arg === "--code-wrap" || arg === "--no-code-wrap") {
      opts.codeWrap = arg === "--code-wrap";
      opts.codeWrapProvided = true;
    } else if (arg === "--editable") {
      opts.editable = true;
    } else if (arg === "--link-preview") {
      const match = requiredValue(argv[++i], "--link-preview", "match regex and a resolver URL template");
      const resolver = requiredValue(argv[++i], "--link-preview", "resolver URL template after the match regex");
      opts.linkPreviews = [...(opts.linkPreviews || []), { match, resolver }];
    } else if (arg === "--link-preview-fields") {
      const value = requiredValue(argv[++i], "--link-preview-fields", "title=path,status=path,priority=path mapping");
      const last = opts.linkPreviews?.at(-1);
      if (!last) throw new Error("--link-preview-fields must follow the --link-preview rule it maps");
      if (last.fields) throw new Error("--link-preview-fields was given twice for the same --link-preview rule");
      last.fields = parseLinkPreviewFieldsArg(value);
    } else if (arg === "--link-preview-header") {
      const value = requiredValue(argv[++i], "--link-preview-header", "'Name: value' header");
      const last = opts.linkPreviews?.at(-1);
      if (!last) throw new Error("--link-preview-header must follow the --link-preview rule it applies to");
      const [name, template] = parseLinkPreviewHeaderArg(value);
      last.headers = { ...(last.headers || {}) };
      if (Object.keys(last.headers).some((key) => key.toLowerCase() === name.toLowerCase())) {
        throw new Error(`--link-preview-header ${name} was given twice for the same --link-preview rule`);
      }
      last.headers[name] = template;
    } else if (arg === "--link-preview-env") {
      const name = requiredValue(argv[++i], "--link-preview-env", "environment variable name");
      if (!isValidEnvName(name)) throw new Error("--link-preview-env requires an environment variable name such as TRACKER_TOKEN");
      opts.linkPreviewAllowedEnv = [...new Set([...(opts.linkPreviewAllowedEnv || []), name])];
    } else if (arg === "--link-preview-allow-remote") {
      opts.linkPreviewAllowRemote = true;
    } else if (arg === "--link-preview-visitors") {
      opts.linkPreviewVisitors = true;
    } else if (arg === "--section-index") {
      opts.sectionIndex = true;
    } else if (arg === "--owner") {
      opts.ownerName = requiredName(argv[++i], arg);
    } else if (arg.startsWith("--") || /^-[A-Za-z]$/.test(arg)) {
      // Longer single-dash words such as "-draft.html" stay positional paths.
      throw unknownOptionError(arg, SERVE_OPTIONS);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new UsageError(`Expected one HTML file, Markdown file, or folder, got ${positional.length}`, {
      hint: "Serve a folder to review several pages in one room, and quote flag values that contain spaces.",
    });
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
  if (opts.ephemeral && opts.agent) {
    throw new Error("--agent requires persistent comments; remove --ephemeral and use the default persistent mode");
  }
  if (opts.ephemeral && opts.agentSession) {
    throw new Error("--agent-session requires persistent comments; remove --ephemeral and use the default persistent mode");
  }
  if (opts.agent && opts.agentSession) {
    throw new Error("Use either --agent or --agent-session, not both");
  }
  if (opts.linkPreviewVisitors && !opts.auth) {
    throw new Error("--link-preview-visitors requires the review-key gate; remove --no-auth");
  }
  if (positional[0]) opts.filePath = resolve(positional[0]);
  return opts;
}

const SERVE_OPTIONS = [
  "--format", "--plain", "--no-color",
  "--help", "--version", "--verbose", "--json", "--port", "--host", "--comments", "--theme", "--markdown-css", "--code-wrap", "--no-code-wrap",
  "--editable", "--section-index", "--link-preview", "--link-preview-fields", "--link-preview-header", "--link-preview-env",
  "--link-preview-allow-remote", "--link-preview-visitors", "--owner", "--ephemeral", "--agent", "--agent-command",
  "--agent-interval", "--agent-policy", "--agent-trigger", "--agent-instructions", "--agent-instructions-file", "--agent-prompt",
  "--agent-prompt-file", "--agent-max-attempts", "--agent-max-passes", "--agent-state", "--agent-session", "--no-tunnel",
  "--no-auth", "--open",
];

// Flags removed in 1.0. They fail with a pointer to the replacement instead of
// silently changing meaning.
const REMOVED_OPTIONS = {
  "--out": "--comments",
  "--live": "--ephemeral",
  "--owner-name": "--owner",
};

// Each subcommand's usage text is the source of truth for its flags, so typo
// suggestions cannot drift from the help a person reads.
export function optionsFromUsage(text) {
  return [...new Set(String(text).match(/--[a-z][a-z-]*/g) || [])];
}

export function unknownOptionError(arg, knownOptions = SERVE_OPTIONS) {
  const name = arg.split("=")[0];
  if (REMOVED_OPTIONS[name]) {
    return new UsageError(`${name} was removed in Tunelito 1.0`, { hint: `Use ${REMOVED_OPTIONS[name]} instead.` });
  }
  const suggestion = closestMatch(name, knownOptions);
  return new UsageError(`Unknown option ${name}`, {
    hint: suggestion ? `Did you mean ${suggestion}?` : undefined,
  });
}

// Subcommand parse failures: one problem line, an optional fix, and a pointer
// to that subcommand's help. Exit code 2 marks a usage error.
function writeUsageFailure(stderr, error, helpCommand, args = []) {
  const usageError = error instanceof UsageError ? error : new UsageError(error.message);
  return writeFailure(stderr, usageError, { code: 2, helpCommand, args });
}

export function writeFailure(stderr, error, { code = error instanceof UsageError ? 2 : 1, helpCommand = code === 2 ? "tunelito --help" : "", args = [], json = machineMode(args) } = {}) {
  const recovery = [...(error.recovery || []), ...(helpCommand ? [{ command: helpCommand }] : code === 1 ? [{ command: "tunelito doctor" }] : [])];
  if (json) {
    stderr.write(`${JSON.stringify({ type: "error", format: "tunelito-error", schemaVersion: 2,
      code: error.reason || (code === 2 ? "USAGE_ERROR" : "RUNTIME_ERROR"),
      message: error.message || String(error), exitCode: code, recovery,
      ...(error.hint ? { hint: error.hint } : {}), ...(error.code ? { cause: error.code } : {}),
    })}\n`);
  } else {
    stderr.write(formatCliError(error, { style: createStyle({ stream: stderr, noColor: globalMode(args).noColor }), helpCommand }));
  }
  return code;
}

const COMMAND_HELP = { serve: () => HELP_TOPICS.all(), doctor: doctorUsage, session: sessionUsage, inbox: inboxUsage,
  comments: commentsUsage, review: reviewUsage, config: configUsage, skill: skillUsage, mcp: mcpUsage };
const SUBCOMMANDS = { session: ["status"], inbox: ["next", "watch", "status", "record"], comments: ["inspect"], review: ["watch"], config: ["show"], skill: ["show", "setup", "install"] };
const SKILL_INSTALL_OPTIONS = `
  --agent <codex|claude>   Agent discovery layout
  --scope <user|project>  Install scope (required)
  --project-root <path>  Project location
  --dry-run              Preview without writing
  --force                Replace an existing skill
`;

export function commandMetadata(path = []) {
  const parts = typeof path === "string" ? path.split(/\s+/).filter(Boolean) : path;
  const [name = "serve", sub, ...extra] = parts;
  const text = COMMAND_HELP[name]?.();
  if (!text || (sub && !SUBCOMMANDS[name]?.includes(sub)) || extra.length) {
    const suggestion = closestMatch(sub || name, sub ? SUBCOMMANDS[name] || [] : Object.keys(COMMAND_HELP));
    throw new UsageError(`Unknown command path ${parts.join(" ")}`, { hint: suggestion ? `Did you mean tunelito help ${sub ? `${name} ` : ""}${suggestion}?` : undefined });
  }
  const source = name === "skill" ? (sub && sub !== "install" ? "" : SKILL_INSTALL_OPTIONS)
    : name === "inbox" && sub ? sub === "record" ? text.slice(text.indexOf("Options for record:")) : text.slice(0, text.indexOf("Options for record:"))
      : text;
  const options = optionMetadata(source);
  const scopedUsage = sub ? [
    `Usage:`, text.split("\n").find((line) => line.trim().startsWith(`tunelito ${name} ${sub} `)) || `  tunelito ${name} ${sub} [options]`,
    "", "Options:", ...options.map((option) => `  ${`${option.name}${option.arity ? " <value>".repeat(option.arity) : ""}`.padEnd(28)} ${option.description}`), "",
  ].join("\n") : text;
  return { path: name === "serve" ? [] : parts, options, commands: sub ? [] : SUBCOMMANDS[name] || [],
    usage: name === "serve" ? usage() : scopedUsage,
    examples: (name === "serve" ? usage() : text).split("\n").filter((line) => /^\s+tunelito /.test(line)).map((line) => line.trim().split(/\s{2,}/)[0]),
  };
}

function allOptionMetadata() {
  return Object.keys(COMMAND_HELP).flatMap((name) => commandMetadata(name).options);
}

function globalMode(args) { return inspectGlobals(args.raw || args, allOptionMetadata()); }
function machineMode(args) { return globalMode(args).json; }

function parseCommandOptions(argv, name, parse) {
  const metadata = commandMetadata(name);
  const { args, globals, positions } = argv.prepared
    ? { args: Array.from(argv), ...argv.prepared }
    : normalizeArguments(argv, metadata.options, metadata.commands);
  if (globals.help || globals.version) return { ...globals };
  const formatIndex = positions["--format"] ?? -1;
  if (formatIndex >= 0 && ["inbox", "review"].includes(name) && args[formatIndex + 1] === "plain") {
    args[formatIndex + 1] = name === "inbox" && ["next", "watch"].some((command) => args.includes(command)) ? "prompt" : "text";
  }
  if (formatIndex >= 0 && name !== "serve" && !["inbox", "review"].includes(name)) {
    const format = args[formatIndex + 1];
    if (!["text", "json", "plain"].includes(format)) throw new UsageError("--format must be text, json, or plain");
    args.splice(formatIndex, 2, ...(format === "json" ? ["--json"] : []));
  }
  const parsed = parse(args);
  if (globals.noColor) parsed.noColor = true;
  if (globals.plain) parsed.plain = true;
  return parsed;
}

export function parseArgs(argv) { return parseCommandOptions(argv, "serve", parseServeOptions); }
export function parseDoctorArgs(argv) { return parseCommandOptions(argv, "doctor", parseDoctorOptions); }
export function parseCommentsArgs(argv) { return parseCommandOptions(argv, "comments", parseCommentsOptions); }
export function parseReviewArgs(argv) { return parseCommandOptions(argv, "review", parseReviewOptions); }
export function parseInboxArgs(argv) { return parseCommandOptions(argv, "inbox", parseInboxOptions); }
export function parseSessionArgs(argv) { return parseCommandOptions(argv, "session", parseSessionOptions); }
export function parseConfigArgs(argv) { return parseCommandOptions(argv, "config", parseConfigOptions); }
export function parseSkillInstallArgs(argv) { return parseCommandOptions(argv, "skill", parseSkillInstallOptions); }

function writeHelp(stdout, path, json) {
  const metadata = commandMetadata(path);
  if (json) stdout.write(`${JSON.stringify({ format: "tunelito-help", schemaVersion: 2, version: VERSION, ...metadata })}\n`);
  else stdout.write(`${metadata.usage.trimEnd()}\n\nGlobal options (before or after any command):\n${GLOBAL_OPTIONS.map((option) => `  ${option.name.padEnd(14)} ${option.description}`).join("\n")}\n`);
}

function commandRunner(name, run) {
  return (rawArgs, options = {}) => {
    const stdout = options.stdout || process.stdout;
    const stderr = options.stderr || process.stderr;
    try {
      const topMetadata = commandMetadata(name);
      const routedSub = routeCommand(rawArgs, topMetadata.options, topMetadata.commands);
      const metadata = routedSub.command !== "serve" ? commandMetadata([name, routedSub.command]) : topMetadata;
      const { globals, args, positions } = normalizeArguments(rawArgs, metadata.options, topMetadata.commands);
      const sub = routedSub.positional;
      if (globals.help || rawArgs[0] === "help" || (!globals.version && topMetadata.commands.length && !routedSub.positional)) {
        const requestedSub = rawArgs.find((arg) => topMetadata.commands.includes(arg));
        writeHelp(stdout, requestedSub ? [name, requestedSub] : [name], globals.json);
        return 0;
      }
      if (globals.version) {
        stdout.write(globals.json ? `${JSON.stringify({ version: VERSION })}\n` : `${VERSION}\n`);
        return 0;
      }
      // Common format selection is normalized to the domain parser's --json.
      const formatIndex = positions["--format"] ?? -1;
      if (formatIndex >= 0 && ["skill", "mcp"].includes(name)) {
        const format = args[formatIndex + 1];
        if (!["text", "json", "plain"].includes(format)) throw new UsageError("--format must be text, json, or plain");
        args.splice(formatIndex, 2, ...(format === "json" ? ["--json"] : []));
      }
      if (name === "mcp" && globals.json) throw new UsageError("mcp uses JSON-RPC on stdout; omit --json");
      if (name === "skill") {
        const index = globals.json ? (positions["--json"] ?? formatIndex) : -1;
        if (index >= 0) args.splice(index, 1);
      }
      const humanPlain = !globals.json && ["comments", "review", "inbox", "skill"].includes(name);
      const output = name === "skill" && globals.json
        ? { write: (text) => stdout.write(`${JSON.stringify({ format: "tunelito-skill", schemaVersion: 2, command: sub, text })}\n`) }
        : humanPlain ? { write: (text) => stdout.write(terminalText(text, { multiline: true })) } : stdout;
      const style = createStyle({ stream: stdout, noColor: globals.noColor });
      args.raw = rawArgs;
      args.prepared = { globals, positions };
      let errorWritten = false;
      const errors = { isTTY: stderr.isTTY, columns: stderr.columns, write: (text) => { errorWritten = true; return stderr.write(text); } };
      const finish = (code) => {
        if (code && !errorWritten && globals.json) writeFailure(stderr, new Error(`${name} did not complete successfully; inspect the stdout result.`), { code, args });
        return code;
      };
      const result = run(args, { ...options, stdout: output, stderr: errors, style, rawArgs,
        log: options.log || ((message) => { if (!globals.json) stderr.write(`${terminalText(message, { multiline: true })}\n`); }),
      });
      return result?.then ? result.then(finish, (error) => writeFailure(stderr, error, { args })) : finish(result);
    } catch (error) {
      return writeFailure(stderr, error instanceof UsageError ? error : new UsageError(error.message), { args: rawArgs, helpCommand: `tunelito ${name} --help` });
    }
  };
}

export const runDoctorCommand = commandRunner("doctor", runDoctor);
export const runMcpCommand = commandRunner("mcp", runMcp);
export const runCommentsCommand = commandRunner("comments", runComments);
export const runReviewCommand = commandRunner("review", runReview);
export const runInboxCommand = commandRunner("inbox", runInbox);
export const runSessionCommand = commandRunner("session", runSession);
export const runConfigCommand = commandRunner("config", runConfig);
export const runSkillCommand = commandRunner("skill", runSkill);

function requiredValue(value, option, detail = "value") {
  if (!value) throw new Error(`${option} requires a ${detail}`);
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
  const raw = process.argv.slice(2);
  const routed = routeCommand(raw, allOptionMetadata(), [...Object.keys(COMMAND_HELP), "help"]);
  const argv = routed.args;
  const runners = { doctor: runDoctorCommand, mcp: runMcpCommand, comments: runCommentsCommand, review: runReviewCommand,
    inbox: runInboxCommand, session: runSessionCommand, config: runConfigCommand, skill: runSkillCommand };
  if (runners[routed.command]) {
    process.exitCode = await runners[routed.command](argv);
    return;
  }
  const fail = (error, code = error instanceof UsageError ? 2 : 1) => {
    process.exitCode = writeFailure(process.stderr, error, { code, args: raw });
  };

  if (routed.command === "help") {
    const { args, globals, positionals: path, positions } = normalizeArguments(argv, allOptionMetadata());
    const formatIndex = positions["--format"];
    if (formatIndex !== undefined && !["text", "json", "plain"].includes(args[formatIndex + 1])) throw new UsageError("--format must be text, json, or plain");
    if (path.length === 1 && HELP_TOPICS[path[0]]) {
      const text = helpTopic(path[0]);
      process.stdout.write(globals.json ? `${JSON.stringify({ format: "tunelito-help", schemaVersion: 2, topic: path[0], options: optionMetadata(text), text })}\n` : text);
    } else writeHelp(process.stdout, path, globals.json);
    return;
  }
  if (argv.length === 0) {
    writeHelp(process.stdout, [], false);
    return;
  }

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    fail(error instanceof UsageError ? error : new UsageError(error.message));
    return;
  }

  if (opts.help) {
    writeHelp(process.stdout, [], opts.json);
    return;
  }

  if (opts.version) {
    process.stdout.write(opts.json ? `${JSON.stringify({ version: VERSION })}\n` : `${VERSION}\n`);
    return;
  }

  if (!opts.filePath) {
    // Never echo argv back: flag values can carry secrets (resolver headers).
    fail(new UsageError("Missing the HTML file, Markdown file, or folder to review", {
      hint: "Put the target first, e.g. tunelito ./page.html --no-tunnel",
    }));
    return;
  }

  if (!existsSync(opts.filePath)) {
    const suggestion = suggestSiblingPath(opts.filePath);
    fail(new UsageError(`No such file or folder: ${displayPath(opts.filePath)}`, {
      hint: suggestion ? `Did you mean ${displayPath(suggestion)}?` : undefined,
    }));
    return;
  }
  const targetStat = statSync(opts.filePath);
  if (!targetStat.isFile() && !targetStat.isDirectory()) {
    fail(new UsageError(`Not a file or folder: ${displayPath(opts.filePath)}`));
    return;
  }
  if (opts.editable && targetStat.isFile() && (!isMarkdownPath(opts.filePath) || opts.filePath.toLowerCase().endsWith(".comments.md"))) {
    fail(new UsageError("--editable needs a source Markdown file, or a folder that contains one", {
      hint: "HTML pages are reviewed read-only; edit them in your editor and browsers reload.",
    }));
    return;
  }
  let resolvedConfig;
  try {
    resolvedConfig = resolveTunelitoConfig({
      targetPath: opts.filePath,
      cliTheme: opts.theme,
      cliThemeProvided: opts.themeProvided,
      cliMarkdownCss: opts.markdownCssHref,
      cliMarkdownCssProvided: opts.markdownCssProvided,
      cliLinkPreviews: opts.linkPreviews,
      cliLinkPreviewsProvided: Boolean(opts.linkPreviews),
      cliCodeWrap: opts.codeWrap,
      cliCodeWrapProvided: opts.codeWrapProvided,
    });
    enforceLinkPreviewHostPolicy(resolvedConfig.linkPreviewRules, { allowRemote: opts.linkPreviewAllowRemote });
    enforceLinkPreviewHeaderPolicy(resolvedConfig.linkPreviewRules, { allowedEnv: opts.linkPreviewAllowedEnv });
  } catch (error) {
    fail(error, 1);
    return;
  }
  const linkPreviewCount = resolvedConfig.linkPreviewRules.length;
  if ((opts.linkPreviewAllowRemote || opts.linkPreviewVisitors || opts.linkPreviewAllowedEnv) && !linkPreviewCount) {
    fail(new UsageError("--link-preview-allow-remote, --link-preview-visitors, and --link-preview-env need a link-preview rule", {
      hint: "Add --link-preview <regex> <url-template>, or a linkPreviews entry in tunelito.config.json.",
    }));
    return;
  }

  const accessKey = opts.auth ? generateAccessKey() : null;
  const sessionId = `s_${generateAccessKey()}`;
  const agentStatePath = (opts.agent || opts.agentSession) ? (opts.agentStatePath || defaultAgentStatePath(opts.filePath)) : null;
  const agentPromptOptions = (opts.agent || opts.agentSession) ? loadAgentPromptOptions(opts) : {};
  const startupWarnings = [];
  let reportWarning = (message) => startupWarnings.push(message);
  const instance = await createTunelitoServer({
    filePath: opts.filePath,
    commentsPath: opts.commentsPath,
    agentStatePath,
    host: opts.host,
    port: opts.port,
    accessKey,
    ownerName: opts.ownerName,
    liveMode: opts.ephemeral,
    sessionId,
    blockedPaths: [
      ...(agentStatePath ? agentBlockedPaths(agentStatePath) : []),
      ...resolvedConfig.blockedPaths,
    ],
    markdownCssHref: resolvedConfig.markdownCssHref,
    markdownCssText: resolvedConfig.markdownCssText,
    markdownTheme: resolvedConfig.theme.value,
    codeWrap: resolvedConfig.codeWrap.value,
    editable: opts.editable,
    sectionIndex: Boolean(opts.sectionIndex),
    linkPreviewRules: resolvedConfig.linkPreviewRules,
    linkPreviewVisitors: Boolean(opts.linkPreviewVisitors),
    linkPreviewAllowRemote: Boolean(opts.linkPreviewAllowRemote),
    linkPreviewAllowedEnv: opts.linkPreviewAllowedEnv || [],
    linkPreviewWarn: (message) => reportWarning(message),
  });
  const reporter = opts.json
    ? createJsonReporter({ stream: process.stdout })
    : createHumanReporter({ stream: process.stderr, folder: targetStat.isDirectory(), noColor: opts.noColor, plain: opts.plain });
  const agentLog = (message) => reporter.agentLog(message);
  runtimeSessionWarning = (message) => reporter.warning(message);
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
      log: agentLog,
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
      log: agentLog,
    })
    : null;

  let tunnel = null;

  const startedAt = Date.now();
  let newComments = 0;

  instance.events.on("viewer-count", (count) => reporter.viewers(count));
  instance.events.on("comment", (comment) => {
    newComments += 1;
    reporter.comment(comment);
    agentWorker?.wake("comment");
    agentSessionWatcher?.wake("comment");
  });
  instance.events.on("review-completed", (completed) => reporter.review(completed));
  instance.events.on("document-changed", () => reporter.reload());

  let agentSessionPath = "";
  let sessionWarning = "";
  try {
    agentSessionPath = writeRuntimeSessionFile({
      targetPath: opts.filePath,
      instance,
      sessionId,
      commentsPath: instance.commentsPath,
      statePath: agentStatePath,
      opts,
      promptAppend: agentPromptOptions.append,
    });
  } catch (error) {
    if (opts.agentSession) {
      await instance.close();
      throw new Error(`Could not write required agent-session metadata: ${error.message}`);
    }
    sessionWarning = error.message;
  }

  installShutdown();
  reporter.startup({
    version: VERSION,
    targetPath: opts.filePath,
    isMarkdownTarget: targetStat.isDirectory() || isMarkdownPath(opts.filePath),
    localUrl: instance.localUrl,
    commentsPath: instance.commentsPath,
    ephemeral: opts.ephemeral,
    auth: opts.auth,
    editable: opts.editable,
    ownerName: opts.ownerName,
    theme: resolvedConfig.theme,
    linkPreviewRows: linkPreviewStartupRows(resolvedConfig, opts),
    agent: agentWorker?.description,
    agentSession: opts.agentSession ? {
      description: agentSessionWatcher.description,
      tracker: inboxStatusCommand({ targetPath: opts.filePath, commentsPath: instance.commentsPath, statePath: agentStatePath, policy: opts.agentPolicy, trigger: opts.agentTrigger }),
      record: agentSessionRecordCommand,
    } : null,
    handoff: reviewWatchCommand({ url: instance.localUrl }),
    sessionPath: agentSessionPath,
    sessionWarning,
    verbose: opts.verbose,
    tunnel: opts.tunnel,
    agentMode: opts.agent ? "worker" : opts.agentSession ? "session" : null,
  });
  reportWarning = (message) => reporter.warning(message);
  for (const message of startupWarnings) reportWarning(message);

  agentWorker?.start();
  agentSessionWatcher?.start();

  if (opts.open) {
    openBrowser(instance.localUrl, { log: (message) => reporter.warning(message) });
  }

  if (opts.tunnel) {
    reporter.tunnel("starting");
    tunnel = startCloudflareTunnel({
      localUrl: instance.originUrl,
      accessKey,
      onUrl(url) {
        const publicUrl = withReviewKey(url, accessKey);
        tryUpdateRuntimeSession(agentSessionPath, () => updateAgentSessionPublicUrl(agentSessionPath, publicUrl));
        reporter.tunnel("ready", { publicUrl });
      },
      onFallback(fallbackPackage) {
        tryUpdateRuntimeSession(agentSessionPath, () => updateSessionFile(agentSessionPath, (session) => ({
          ...session,
          tunnel: { ...session.tunnel, state: "starting", fallbackPackage },
          lastActivityAt: new Date().toISOString(),
        })));
        reporter.tunnel("fallback", { package: fallbackPackage });
      },
      onProgress(progress) {
        if (progress?.type === "dns-wait") {
          reporter.tunnel("dns-wait", { hostname: progress.hostname, code: progress.code });
        }
      },
      onError(error) {
        tryUpdateRuntimeSession(agentSessionPath, () => updateSessionFile(agentSessionPath, (session) => ({
          ...session,
          lifecycle: "degraded",
          tunnel: { ...session.tunnel, state: "unavailable", error: error.message },
          lastActivityAt: new Date().toISOString(),
        })));
        reporter.tunnel("unavailable", { error: error.message });
      },
    });
  } else {
    reporter.tunnel("disabled");
  }

  function installShutdown() {
    const shutdown = createShutdownHandler({
      cleanup: async () => {
        // Closing sockets/workers emits events; stopped must remain last.
        reporter.mute();
        return Promise.allSettled([
          Promise.resolve().then(() => tunnel?.stop()),
          Promise.resolve().then(() => agentWorker?.stop()),
          Promise.resolve().then(() => agentSessionWatcher?.stop()),
          Promise.resolve().then(() => instance.close()),
        ]);
      },
      stopped: (termination) => {
        tryUpdateRuntimeSession(agentSessionPath, () => updateSessionFile(agentSessionPath, (session) => ({
          ...session,
          lifecycle: termination.cleanup === "complete" ? "stopped" : "degraded",
          stoppedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          tunnel: { ...session.tunnel, state: termination.cleanup === "complete" ? (session.tunnel?.enabled ? "stopped" : "disabled") : "unconfirmed" },
        })));
        reporter.stopped({
          elapsedMs: Date.now() - startedAt, newComments,
          ephemeral: opts.ephemeral, commentsPath: instance.commentsPath,
          targetPath: opts.filePath, ...termination,
        });
      },
      failure: (reason, message, code) => {
        if (opts.json || reason !== "CANCELLED") writeFailure(process.stderr, Object.assign(new Error(message), { reason }), { code, json: Boolean(opts.json), args: raw });
      },
      restore: () => reporter.restore?.(),
      drain: () => Promise.all([process.stdout, process.stderr].map((stream) => new Promise((resolveFlush) => stream.write("", resolveFlush)))),
    });

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void shutdown(signal));
  }
}

// Serve swaps this for a writer-aware logger so warnings do not land inside
// the pending Public row on a TTY.
let runtimeSessionWarning = (message) => console.warn(`Session: ${message}`);

function tryUpdateRuntimeSession(sessionPath, update) {
  if (!sessionPath) return;
  try {
    update();
  } catch (error) {
    runtimeSessionWarning(`could not update metadata (${error.message})`);
  }
}

function doctorUsage() {
  return `Tunelito doctor -- read-only local setup and safety diagnostics.

Usage:
  tunelito doctor [page.html|notes.md|folder] [options]

Options:
  --comments <path>         Markdown comments file to inspect
  --agent-state <path>      Agent resolution ledger to inspect
  --host <host>             Host to evaluate (default: 127.0.0.1)
  --port <number>           Port to evaluate (default: 4317)
  --no-auth                 Evaluate an unauthenticated session shape
  --no-tunnel               Evaluate a local-only session shape
  --ephemeral               Evaluate in-memory-only persistence
  --agent <codex|claude|custom>
                            Evaluate local agent worker compatibility
  --agent-session           Evaluate active-agent session compatibility
  --agent-policy <mode>     Which comments are actionable: ${AGENT_POLICIES.join("|")} (default: ${DEFAULT_AGENT_POLICY})
  --agent-trigger <txt>     Marker for mention policies, or "all" (default: ${DEFAULT_AGENT_TRIGGER})
  --json                    Print the machine-readable tunelito-doctor report
`;
}

function parseDoctorOptions(argv) {
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
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "-h" || arg === "--help" || arg === "help") {
      opts.help = true;
    } else if (arg === "--comments") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--comments", "path"));
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
    } else if (arg === "--ephemeral") {
      opts.ephemeral = true;
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
      throw unknownOptionError(arg, optionsFromUsage(doctorUsage()));
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(`Expected zero or one HTML file, Markdown file, or folder, got ${positional.length}`);
  }
  if (opts.agent && !["codex", "claude", "custom"].includes(opts.agent)) {
    throw new Error(`Unsupported --agent provider: ${opts.agent}`);
  }
  validateMentionAgentPolicy(opts.agentPolicy, opts.agentTrigger);
  if (positional[0]) opts.targetPath = resolve(positional[0]);
  return opts;
}

async function runDoctor(args, { stdout = process.stdout, stderr = process.stderr, deps = {}, style = createStyle({ stream: stdout }) } = {}) {
  let opts;
  try {
    opts = parseDoctorArgs(args);
  } catch (error) {
    return writeUsageFailure(stderr, error, "tunelito doctor --help", args);
  }

  if (opts.help) {
    stdout.write(doctorUsage());
    return 0;
  }

  const report = await buildDoctorReport(opts, deps);
  stdout.write(formatDoctorReport(report, opts.format, style));
  if (!report.ok && machineMode(args)) writeFailure(stderr, new Error("Doctor found problems; inspect the checks in the stdout report."), { args });
  return report.ok ? 0 : 1;
}

const DOCTOR_STATUS_ORDER = { fail: 0, warn: 1, pass: 2 };

// Problems first, then passing checks, so the line that needs action is the
// first one a person reads.
export function formatDoctorReport(report, format, style = plainStyle) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  const { errors, warnings, info } = report.summary;
  const summary = [
    errors ? style.red(plural(errors, "error")) : null,
    warnings ? style.yellow(plural(warnings, "warning")) : null,
    `${info} passed`,
  ].filter(Boolean).join(" · ");
  const lines = [
    `${style.bold("tunelito doctor")} · ${report.ok ? style.green("ok") : style.red("needs attention")}`,
    summary,
    "",
  ];
  const checks = [...report.checks].sort((a, b) => (DOCTOR_STATUS_ORDER[a.status] ?? 3) - (DOCTOR_STATUS_ORDER[b.status] ?? 3));
  const idWidth = Math.max(0, ...checks.map((check) => check.id.length));
  const tone = { fail: style.red, warn: style.yellow, pass: style.green };
  for (const check of checks) {
    const status = (tone[check.status] || String)(terminalText(check.status).padEnd(4));
    lines.push(`  ${status}  ${terminalText(check.id).padEnd(idWidth)}  ${terminalText(check.message)}`);
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

function runMcp(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const sub = args[0];
  if (sub === "help" || sub === "-h" || sub === "--help") {
    stdout.write(mcpUsage());
    return 0;
  }
  if (args.length) {
    return writeUsageFailure(stderr, new UsageError(`Unknown mcp argument ${sub}`, { hint: "tunelito mcp takes no arguments; configure it in your MCP client." }), "tunelito mcp --help", args);
  }
  createMcpServer({ stdin, stdout, stderr });
  return 0;
}

function commentsUsage() {
  return `Tunelito comments -- structured comments inbox tools.

Usage:
  tunelito comments inspect <page.html|notes.md|folder|comments.md> [options]

Commands:
  inspect     Print an index for a Tunelito comments inbox
  help        Show this message

Options:
  --comments <path>     Markdown comments file for a page, Markdown, or folder target
  --agent-state <path>  Agent resolution ledger for processing status
  --json                Print the machine-readable tunelito-comments index
`;
}

function parseCommentsOptions(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { help: true };
  }
  if (command !== "inspect") {
    throw new UsageError(`Unknown comments command ${command}`, { hint: "The only comments command is inspect." });
  }

  const opts = { command, format: "text" };
  const positional = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--comments") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--comments", "path"));
    } else if (arg === "--agent-state") {
      opts.agentStatePath = resolve(requiredValue(argv[++i], "--agent-state"));
    } else if (arg === "--json") {
      opts.format = "json";
    } else if (arg.startsWith("--")) {
      throw unknownOptionError(arg, optionsFromUsage(commentsUsage()));
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1 && !opts.help) {
    throw new Error(`Expected one page, folder, or comments file, got ${positional.length}`);
  }

  if (positional[0]) {
    const inputPath = resolve(positional[0]);
    const inputLooksLikeComments = looksLikeCommentsInboxPath(inputPath);
    if (opts.commentsPath && inputLooksLikeComments) {
      throw new UsageError("--comments only applies when inspecting a page, Markdown file, or folder", {
        hint: "You passed a comments file directly; drop --comments.",
      });
    }
    if (!opts.commentsPath && inputLooksLikeComments) {
      opts.commentsPath = inputPath;
      opts.requireCommentsFile = true;
    } else {
      opts.targetPath = inputPath;
    }
  }

  return opts;
}

function looksLikeCommentsInboxPath(inputPath) {
  if (!/\.md$/i.test(inputPath)) return false;
  if (/\.comments\.md$/i.test(inputPath)) return true;
  if (!existsSync(inputPath)) return false;
  try {
    const sample = readFileSync(inputPath, "utf8").slice(0, 4096);
    return /^# Tunelito comments for `/m.test(sample) || sample.includes("<!-- tunelito-comment:");
  } catch {
    return false;
  }
}

function runComments(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseCommentsArgs(args);
  } catch (error) {
    return writeUsageFailure(stderr, error, "tunelito comments --help", args);
  }

  if (opts.help) {
    stdout.write(commentsUsage());
    return 0;
  }

  const index = buildCommentsIndex({
    targetPath: opts.targetPath,
    commentsPath: opts.commentsPath,
    requireCommentsFile: opts.requireCommentsFile,
    agentStatePath: opts.agentStatePath,
  });
  stdout.write(formatCommentsIndex(index, opts.format));
  if (!index.ok && machineMode(args)) writeFailure(stderr, new Error("Comments inspection found problems; inspect the stdout diagnostics."), { args });
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
    `Pending:  ${index.summary.pending ?? "unknown"}`,
    `Unhandled: ${index.summary.unhandled ?? "unknown"}`,
    diagnostics,
  ].join("\n");
}

function reviewUsage() {
  return `Tunelito review -- reviewer handoff event commands.

Usage:
  tunelito review watch [page.html|notes.md|folder] [options]

Commands:
  watch       Wait for the next Done Reviewing handoff event
  help        Show this message

Options:
  --url <url>        Local Tunelito review URL printed by the running server
  --timeout <s>      Stop waiting after this many seconds (default: 0, no timeout)
  --after <n|latest> Replay retained events after this sequence (default: 0)
  --format <text|json>
                     Output format (default: text)
  --json             Print the machine-readable review.completed event
`;
}

function parseReviewOptions(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { help: true };
  }
  if (command !== "watch") {
    throw new UsageError(`Unknown review command ${command}`, { hint: "The only review command is watch." });
  }

  const opts = { command, format: "text", timeoutSeconds: 0, after: 0 };
  const positional = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--url") {
      opts.url = requiredValue(argv[++i], "--url");
    } else if (arg === "--timeout") {
      opts.timeoutSeconds = parseIntegerValue(argv[++i], "--timeout", { min: 0 });
    } else if (arg === "--after") {
      opts.after = parseReviewAfterValue(requiredValue(argv[++i], "--after"));
    } else if (arg === "--format") {
      opts.format = requiredValue(argv[++i], "--format");
    } else if (arg === "--json") {
      opts.format = "json";
    } else if (arg.startsWith("--")) {
      throw unknownOptionError(arg, optionsFromUsage(reviewUsage()));
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1 && !opts.help) {
    throw new Error(`Expected zero or one HTML file, Markdown file, or folder, got ${positional.length}`);
  }
  if (!["text", "json"].includes(opts.format)) {
    throw new Error("Unsupported --format for review watch: use text or json");
  }
  if (positional[0]) opts.targetPath = resolve(positional[0]);
  return opts;
}

async function runReview(args, { stdout = process.stdout, stderr = process.stderr, fetchFn = globalThis.fetch } = {}) {
  let opts;
  try {
    opts = parseReviewArgs(args);
  } catch (error) {
    return writeUsageFailure(stderr, error, "tunelito review --help", args);
  }

  if (opts.help) {
    stdout.write(reviewUsage());
    return 0;
  }

  try {
    if (typeof fetchFn !== "function") throw new Error("review watch requires a fetch implementation");
    const sessionUrl = opts.url || reviewUrlFromSessionFile(opts.targetPath);
    const response = await fetchFn(buildReviewEventsUrl(sessionUrl, opts), { cache: "no-store" });
    const body = await response.text();
    const payload = JSON.parse(body);
    stdout.write(formatReviewWatchResult(payload, opts.format));
    return response.ok ? 0 : 1;
  } catch (error) {
    return writeFailure(stderr, error, { args });
  }
}

function parseReviewAfterValue(value) {
  if (value === "latest") return value;
  return parseIntegerValue(value, "--after", { min: 0 });
}

function reviewUrlFromSessionFile(targetPath) {
  if (!targetPath) throw new Error("review watch requires --url or a target with .tunelito/session.json metadata");
  const sessionPath = join(agentWorkspaceRoot(targetPath), ".tunelito", "session.json");
  if (!existsSync(sessionPath)) throw new Error(`Review session metadata not found: ${sessionPath}. Pass --url with the running Tunelito Local URL.`);
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  const url = session.reviewUrl || session.localUrl || session.originUrl;
  if (!url) throw new Error(`Review session metadata does not include a review URL: ${sessionPath}`);
  return url;
}

function buildReviewEventsUrl(sessionUrl, opts) {
  const source = new URL(sessionUrl);
  const url = new URL(REVIEW_EVENTS_ROUTE, source.origin);
  for (const [key, value] of source.searchParams) url.searchParams.set(key, value);
  url.searchParams.set("after", String(opts.after));
  if (opts.timeoutSeconds > 0) url.searchParams.set("timeout", String(opts.timeoutSeconds));
  return url;
}

function formatReviewWatchResult(payload, format) {
  if (format === "json") return `${JSON.stringify(payload, null, 2)}\n`;
  if (payload.type === "review.timeout") {
    return `Timed out waiting for review.completed after ${payload.timeoutSeconds}s\n`;
  }
  const summary = payload.summary || {};
  return [
    `Review completed #${payload.sequence}`,
    `Target:   ${payload.targetPath || "(unknown)"}`,
    `Comments: ${summary.comments ?? summary.total ?? 0}`,
    `Page:     ${summary.page ?? 0}`,
    `Site:     ${summary.site ?? 0}`,
    `Owner:    ${summary.owner ?? 0}`,
    `Visitor:  ${summary.visitor ?? 0}`,
    "",
  ].join("\n");
}

function inboxUsage() {
  return `Tunelito inbox -- active-agent comment inbox commands.

Usage:
  tunelito inbox next <page.html|notes.md|folder> [options]
  tunelito inbox watch <page.html|notes.md|folder> [options]
  tunelito inbox status <page.html|notes.md|folder> [options]
  tunelito inbox record <page.html|notes.md|folder> --id <id> --status <status> [options]

Commands:
  next        Claim pending comments and print a prompt for the current agent
  watch       Wait for the next pending comment, claim it, then print a prompt
  status      Print a live to-do tracker from the comments inbox and ledger
  record      Record the current agent's result in .tunelito/agent/state.json
  help        Show this message

Options for next/watch/status:
  --comments <path>         Markdown comments file (default: <page-or-folder>.comments.md)
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
  --claim-owner <name>      Label for the active agent claim (default: inbox-command)
  --claim-ttl <s>           Claim lease in seconds (default: ${DEFAULT_INBOX_CLAIM_SECONDS})
  --wait                    Wait until an actionable comment exists
  --wait-interval <s>       Fallback polling interval while waiting (default: ${DEFAULT_INBOX_WAIT_INTERVAL_SECONDS})
  --timeout <s>             Stop waiting after this many seconds (default: 0, no timeout)
  --format <prompt|json|ids>
                            Output format for next/watch (default: prompt)
  --format <text|json>      Output format for status (default: text)
  --json                    Same as --format json

Options for record:
  --comments <path>         Markdown comments file (default: <page-or-folder>.comments.md)
  --agent-state <path>      Agent resolution ledger (default: <target>/.tunelito/agent/state.json)
  --id <id>                 Comment id to record
  --claim <id|auto>         Active claim id from inbox next/watch, or auto to use the current claim
  --status <status>         resolved|no-op|blocked|stale|ignored|partial|needs_followup
  --summary <txt>           Short result summary
  --file <path>             Changed file; repeat for multiple files
  --completed <txt>         Completed task; repeat for multiple tasks
  --remaining <txt>         Remaining task; repeat for needs_followup
  --agent-max-passes <n>    Pass limit used for needs_followup records (default: ${DEFAULT_AGENT_MAX_PASSES})
  --format <text|json>      Output format for record (default: text)
  --json                    Same as --format json
`;
}

function parseInboxOptions(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { help: true };
  }
  if (!["next", "watch", "status", "record"].includes(command)) {
    const suggestion = closestMatch(command, ["next", "watch", "status", "record"]);
    throw new UsageError(`Unknown inbox command ${command}`, {
      hint: suggestion ? `Did you mean inbox ${suggestion}?` : "Inbox commands: next, watch, status, record.",
    });
  }

  const opts = {
    command,
    wait: command === "watch",
    agentPolicy: DEFAULT_AGENT_POLICY,
    agentTrigger: DEFAULT_AGENT_TRIGGER,
    agentMaxAttempts: DEFAULT_AGENT_MAX_ATTEMPTS,
    agentMaxPasses: DEFAULT_AGENT_MAX_PASSES,
    limit: 1,
    claimOwner: "inbox-command",
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
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--comments") {
      opts.commentsPath = resolve(requiredValue(argv[++i], "--comments", "path"));
    } else if (arg === "--json") {
      opts.format = "json";
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
      throw unknownOptionError(arg, optionsFromUsage(inboxUsage()));
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1 && !opts.help) {
    throw new Error(`Expected one HTML file, Markdown file, or folder, got ${positional.length}`);
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

async function runInbox(args, { stdout = process.stdout, stderr = process.stderr, now = () => new Date(), log = (message) => stderr.write(`${terminalText(message, { multiline: true })}\n`) } = {}) {
  let opts;
  try {
    opts = parseInboxArgs(args);
  } catch (error) {
    return writeUsageFailure(stderr, error, "tunelito inbox --help", args);
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
    return writeFailure(stderr, error, { args });
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

export function writeAgentSessionFile({ targetPath, commentsPath, statePath, policy, trigger, maxAttempts, maxPasses, ownerName, promptAppend, reviewUrl = "" }) {
  const sessionId = `s_${generateAccessKey()}`;
  const workspaceRoot = agentWorkspaceRoot(targetPath);
  const sessionPath = sessionPathForTarget(targetPath);
  const createdAt = new Date().toISOString();
  const session = {
    format: SESSION_FORMAT,
    schemaVersion: SESSION_VERSION,
    version: 1,
    sessionId,
    tunelitoVersion: VERSION,
    mode: "agent-session",
    targetPath,
    workspaceRoot,
    sourceRoot: workspaceRoot,
    directoryMode: existsSync(targetPath) ? statSync(targetPath).isDirectory() : false,
    commentsPath,
    persistence: "persistent",
    statePath,
    policy,
    trigger,
    maxAttempts,
    maxPasses,
    ownerName: ownerName || "",
    hasInstructions: Boolean(promptAppend),
    reviewUrl,
    reviewWatchCommand: reviewUrl ? reviewWatchCommand({ url: reviewUrl }) : "",
    nextCommand: inboxWatchCommand({ targetPath, commentsPath, statePath, policy, trigger, maxAttempts, maxPasses }),
    statusCommand: inboxStatusCommand({ targetPath, commentsPath, statePath, policy, trigger }),
    recordCommand: inboxRecordCommand({ targetPath, commentsPath, statePath, maxPasses }),
    agent: {
      mode: "agent-session",
      provider: "current",
      statePath,
      policy,
      trigger,
    },
    pid: process.pid,
    lifecycle: "running",
    localUrl: reviewUrl,
    publicUrl: "",
    tunnel: { enabled: false, state: "disabled", error: null },
    createdAt,
    startedAt: createdAt,
    lastActivityAt: createdAt,
  };
  return writeSessionFile(sessionPath, session);
}

export function updateAgentSessionPublicUrl(sessionPath, publicUrl) {
  updateSessionFile(sessionPath, (session) => ({
    ...session,
    lifecycle: "running",
    publicUrl,
    reviewUrl: publicUrl,
    reviewWatchCommand: reviewWatchCommand({ url: publicUrl }),
    tunnel: { ...session.tunnel, enabled: true, state: "connected", error: null },
    lastActivityAt: new Date().toISOString(),
  }));
}

function writeRuntimeSessionFile({ targetPath, instance, sessionId, commentsPath, statePath, opts, promptAppend }) {
  const workspaceRoot = agentWorkspaceRoot(targetPath);
  const startedAt = instance.startedAt || new Date().toISOString();
  const mode = opts.agentSession ? "agent-session" : opts.agent ? "worker" : "none";
  const session = {
    format: SESSION_FORMAT,
    schemaVersion: SESSION_VERSION,
    version: 1,
    sessionId,
    tunelitoVersion: VERSION,
    mode,
    targetPath,
    workspaceRoot,
    sourceRoot: workspaceRoot,
    directoryMode: Boolean(instance.directoryMode),
    commentsPath: commentsPath || null,
    persistence: opts.ephemeral ? "ephemeral" : "persistent",
    editable: Boolean(opts.editable),
    statePath: statePath || null,
    policy: mode === "none" ? "" : opts.agentPolicy,
    trigger: mode === "none" ? "" : opts.agentTrigger,
    maxAttempts: mode === "none" ? null : opts.agentMaxAttempts,
    maxPasses: mode === "none" ? null : opts.agentMaxPasses,
    ownerName: opts.ownerName || "",
    hasInstructions: Boolean(promptAppend),
    localUrl: instance.localUrl,
    publicUrl: "",
    reviewUrl: instance.localUrl,
    reviewWatchCommand: reviewWatchCommand({ url: instance.localUrl }),
    agent: {
      mode,
      provider: opts.agent || (opts.agentSession ? "current" : ""),
      statePath: statePath || null,
      policy: mode === "none" ? "" : opts.agentPolicy,
      trigger: mode === "none" ? "" : opts.agentTrigger,
    },
    pid: process.pid,
    lifecycle: "running",
    tunnel: {
      enabled: Boolean(opts.tunnel),
      state: opts.tunnel ? "starting" : "disabled",
      error: null,
    },
    createdAt: startedAt,
    startedAt,
    lastActivityAt: startedAt,
  };
  if (opts.agentSession) {
    Object.assign(session, {
      nextCommand: inboxWatchCommand({
        targetPath,
        commentsPath,
        statePath,
        policy: opts.agentPolicy,
        trigger: opts.agentTrigger,
        maxAttempts: opts.agentMaxAttempts,
        maxPasses: opts.agentMaxPasses,
      }),
      statusCommand: inboxStatusCommand({
        targetPath,
        commentsPath,
        statePath,
        policy: opts.agentPolicy,
        trigger: opts.agentTrigger,
      }),
      recordCommand: inboxRecordCommand({ targetPath, commentsPath, statePath, maxPasses: opts.agentMaxPasses }),
    });
  }
  return writeSessionFile(sessionPathForTarget(targetPath), session);
}

function sessionUsage() {
  return `Tunelito session -- inspect a recoverable local review session.

Usage:
  tunelito session status [page.html|notes.md|folder] [options]

Options:
  --json        Print the versioned machine-readable status report
  --redact      Redact the review key from URLs
  -h, --help    Show this message
`;
}

function parseSessionOptions(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") return { help: true };
  if (command !== "status") throw new UsageError(`Unknown session command ${command}`, { hint: "The only session command is status." });
  const opts = { command, targetPath: resolve(process.cwd()), format: "text", redact: false };
  const positional = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "--json") opts.format = "json";
    else if (arg === "--redact") opts.redact = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) throw unknownOptionError(arg, optionsFromUsage(sessionUsage()));
    else positional.push(arg);
  }
  if (positional.length > 1) throw new Error(`Expected zero or one HTML file, Markdown file, or folder, got ${positional.length}`);
  if (positional[0]) opts.targetPath = resolve(positional[0]);
  return opts;
}

async function runSession(args, {
  stdout = process.stdout,
  stderr = process.stderr,
  inspect = inspectSession,
  fetchFn,
  isProcessAlive,
  now,
  style = createStyle({ stream: stdout }),
} = {}) {
  let opts;
  try {
    opts = parseSessionArgs(args);
  } catch (error) {
    return writeUsageFailure(stderr, error, "tunelito session --help", args);
  }
  if (opts.help) {
    stdout.write(sessionUsage());
    return 0;
  }
  let commentsIndex = null;
  try {
    const { session } = readSessionMetadata(opts.targetPath);
    if (session.commentsPath) {
      commentsIndex = buildCommentsIndex({
        targetPath: session.targetPath,
        commentsPath: session.commentsPath,
        agentStatePath: session.agent?.statePath || session.statePath,
      });
    }
  } catch {
    // inspectSession provides the canonical missing/corrupt metadata error.
  }
  try {
    const report = await inspect(opts.targetPath, {
      ...(fetchFn ? { fetchFn } : {}),
      ...(isProcessAlive ? { isProcessAlive } : {}),
      ...(now ? { now } : {}),
      redact: opts.redact,
      commentsIndex,
    });
    stdout.write(opts.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : formatSessionStatus(report, style, { columns: stdout.columns }));
    if (!["running", "degraded"].includes(report.status) && machineMode(args)) writeFailure(stderr, new Error("The session is not running; inspect stdout recovery guidance."), { args });
    return report.status === "running" || report.status === "degraded" ? 0 : 1;
  } catch (error) {
    return writeFailure(stderr, error, { args });
  }
}

function readSessionMetadata(targetPath) {
  const path = sessionPathForTarget(targetPath);
  return { sessionPath: path, session: JSON.parse(readFileSync(path, "utf8")) };
}

function reviewWatchCommand({ url }) {
  return [
    "tunelito",
    "review",
    "watch",
    "--url",
    shellQuote(url),
    "--json",
  ].join(" ");
}

function inboxWatchCommand({ targetPath, commentsPath, statePath, policy, trigger, maxAttempts, maxPasses }) {
  return [
    "tunelito",
    "inbox",
    "watch",
    shellQuote(targetPath),
    "--comments",
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
    "--comments",
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
    "--comments",
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
  return readFileSync(new URL("../docs-site/skill.md", import.meta.url), "utf8")
    .replace("__TUNELITO_VERSION__", VERSION);
}

function configUsage() {
  return `Tunelito config -- resolved Markdown presentation settings.

Usage:
  tunelito config show [page.html|notes.md|folder] [options]

Options:
  --theme <name>        Override the resolved theme for this invocation
  --markdown-css <href> Override configured Markdown CSS for this invocation
  --code-wrap, --no-code-wrap
                        Override configured code block wrapping for this invocation
  --json                Print the versioned machine-readable config report
`;
}

function parseConfigOptions(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { help: true };
  }
  if (command !== "show") throw new UsageError(`Unknown config command ${command}`, { hint: "The only config command is show." });

  const opts = { command, format: "text" };
  const positional = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--theme") {
      opts.theme = requiredValue(argv[++i], "--theme", "theme name");
      opts.themeProvided = true;
    } else if (arg === "--markdown-css") {
      opts.markdownCssHref = normalizeMarkdownCssHref(requiredValue(argv[++i], "--markdown-css"));
      opts.markdownCssProvided = true;
    } else if (arg === "--code-wrap" || arg === "--no-code-wrap") {
      opts.codeWrap = arg === "--code-wrap";
      opts.codeWrapProvided = true;
    } else if (arg === "--json") {
      opts.format = "json";
    } else if (arg.startsWith("--")) {
      throw unknownOptionError(arg, optionsFromUsage(configUsage()));
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) {
    throw new Error(`Expected zero or one HTML file, Markdown file, or folder, got ${positional.length}`);
  }
  opts.targetPath = resolve(positional[0] || process.cwd());
  return opts;
}

function runConfig(args, {
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  homePath,
  style = createStyle({ stream: stdout }),
} = {}) {
  let opts;
  try {
    opts = parseConfigArgs(args);
  } catch (error) {
    return writeUsageFailure(stderr, error, "tunelito config --help", args);
  }
  if (opts.help) {
    stdout.write(configUsage());
    return 0;
  }

  let config;
  try {
    config = resolveTunelitoConfig({
      targetPath: opts.targetPath,
      cliTheme: opts.theme,
      cliThemeProvided: opts.themeProvided,
      cliMarkdownCss: opts.markdownCssHref,
      cliMarkdownCssProvided: opts.markdownCssProvided,
      cliCodeWrap: opts.codeWrap,
      cliCodeWrapProvided: opts.codeWrapProvided,
      env,
      ...(homePath ? { homePath } : {}),
    });
  } catch (error) {
    return writeFailure(stderr, error, { args });
  }

  const report = publicConfigReport(config);
  if (opts.format === "json") {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const source = (value) => (value === "default" ? "default" : `from ${value}`);
    const fileState = (file) => (file.exists ? "found" : "missing");
    stdout.write([
      `${style.bold("tunelito config")} · ${terminalText(displayPath(report.targetPath))}`,
      "",
      ...formatRows([
        { label: "Theme", value: report.theme.value, hint: source(report.theme.source) },
        { label: "Markdown CSS", value: report.markdownCss.resolved || "none", hint: source(report.markdownCss.source) },
        { label: "Code wrap", value: report.codeWrap.value ? "on" : "off", hint: source(report.codeWrap.source) },
        { label: "Link previews", value: plural(report.linkPreviews.rules.length, "rule"), hint: source(report.linkPreviews.source) },
        ...config.linkPreviewRules.filter((rule) => rule.headers.length).map((rule) => ({
          label: "Headers",
          value: `${rule.origin} <- ${describeLinkPreviewHeaders(rule.headers)}`,
          hint: "needs --link-preview-env when serving",
        })),
        { label: "Project root", value: displayPath(report.projectRoot) },
        { label: "Project file", value: displayPath(report.configFiles.project.path), hint: fileState(report.configFiles.project) },
        { label: "Global file", value: displayPath(report.configFiles.global.path), hint: fileState(report.configFiles.global) },
        { label: "Themes", value: report.availableThemes.map((theme) => theme.name).join(", ") },
      ], style, { columns: stdout.columns }),
      "",
    ].join("\n"));
  }
  return 0;
}

// Startup summary for link previews. Resolver headers are listed by name and source
// variable only, never by value.
export function linkPreviewStartupRows(resolvedConfig, opts = {}) {
  const rules = resolvedConfig.linkPreviewRules || [];
  if (!rules.length) return [];
  const rows = [
    {
      label: "Previews",
      value: `${plural(rules.length, "link-preview rule")} for ${opts.linkPreviewVisitors ? "the owner and keyed visitors" : "the local owner only"}${opts.linkPreviewAllowRemote ? "; remote resolvers allowed" : ""}`,
      hint: `from ${resolvedConfig.linkPreviews.source}`,
    },
    { label: "Resolver", value: [...new Set(rules.map((rule) => rule.origin))].join(", ") },
  ];
  const headerLines = rules.filter((rule) => rule.headers?.length).map((rule) => `${rule.origin} <- ${describeLinkPreviewHeaders(rule.headers)}`);
  if (headerLines.length) rows.push({ label: "Headers", value: [...new Set(headerLines)].join("; "), hint: "owner only" });
  return rows;
}

export function linkPreviewStartupLines(resolvedConfig, opts = {}) {
  return formatRows(linkPreviewStartupRows(resolvedConfig, opts), plainStyle, { labelWidth: STARTUP_LABEL_WIDTH });
}

const STARTUP_LABEL_PUBLIC = "Public";
const STARTUP_LABEL_WIDTH = 8;

// The startup block a person reads once before a call. The share URL is the
// focal row (printed after this block as the tunnel resolves); everything an
// agent needs lives in session.json and --verbose.
export function formatStartup(model, style = plainStyle) {
  const target = terminalText(displayPath(model.targetPath) || model.targetPath);
  const lines = [
    `${style.bold("tunelito")} ${terminalText(model.version)} · ${target}`,
    model.auth
      ? "Keyed links · Ctrl-C to stop"
      : `${style.yellow("Open links (--no-auth)")} · Ctrl-C to stop`,
    "",
  ];

  const showTheme = model.verbose || (model.isMarkdownTarget && model.theme && model.theme.source !== "default");
  const rows = [
    { label: "Local", value: model.localUrl, hint: "you, on this machine" },
    model.ephemeral
      ? { label: "Comments", value: "in memory only; lost when Tunelito stops", tone: "warn" }
      : { label: "Comments", value: displayPath(model.commentsPath) },
    !model.auth ? { label: "Access", value: "anyone with a link can view and comment", tone: "warn" } : null,
    model.editable ? { label: "Editing", value: "on for the Local URL only; shared links stay read-only" } : null,
    model.ownerName ? { label: "Owner", value: model.ownerName } : null,
    showTheme && model.theme ? { label: "Theme", value: model.theme.value, hint: model.theme.source === "default" ? "default" : `from ${model.theme.source}` } : null,
    ...(model.linkPreviewRows || []),
    model.agent ? { label: "Agent", value: model.agent } : null,
    model.agentSession ? { label: "Agent", value: model.agentSession.description } : null,
    model.agentSession ? { label: "Tracker", value: model.agentSession.tracker } : null,
    model.agentSession ? { label: "Record", value: model.agentSession.record } : null,
    model.verbose && model.ephemeral ? { label: "Sync", value: "WebRTC peer-to-peer when available; WebSocket relay fallback" } : null,
    (model.verbose || model.agentSession) && model.handoff ? { label: "Handoff", value: model.handoff } : null,
    (model.verbose || model.agentSession) && model.sessionPath ? { label: "Session", value: displayPath(model.sessionPath) } : null,
    model.sessionWarning ? { label: "Session", value: `metadata unavailable (${model.sessionWarning})`, tone: "warn" } : null,
  ];
  return [...lines, ...formatRows(rows, style, { labelWidth: STARTUP_LABEL_WIDTH, columns: model.columns })];
}

// Serve output goes through a reporter so people and agents get the same
// events: a human terminal view, or one JSON object per line with --json.
export function createHumanReporter({ stream = process.stderr, folder = false, noColor = false, plain = false, env = process.env, style = createStyle({ stream, env, noColor: noColor || plain }), now = () => new Date() } = {}) {
  const out = createTerminalWriter({ stream, env, plain });
  let muted = false;
  const event = (verb, text, tone) => {
    if (!muted) out.line(formatEvent(verb, text, { style, tone, now: now() }));
  };
  const publicRow = (value, extra = {}) => formatRows([{ label: STARTUP_LABEL_PUBLIC, value, ...extra }], style, { labelWidth: STARTUP_LABEL_WIDTH, columns: stream.columns })[0];
  const indentRow = (value) => formatRows([{ label: "", value }], style, { labelWidth: STARTUP_LABEL_WIDTH, columns: stream.columns })[0];
  return {
    startup(model) {
      for (const line of formatStartup({ ...model, columns: stream.columns }, style)) out.line(line);
    },
    tunnel(state, details = {}) {
      if (state === "starting") out.status(publicRow("starting Cloudflare Tunnel…"));
      else if (state === "fallback") out.status(publicRow(`cloudflared not found; trying npx ${details.package}…`));
      else if (state === "dns-wait") out.status(publicRow(`waiting for DNS on ${details.hostname} (${details.code}; up to ~2 min)…`));
      else if (state === "ready") {
        out.settle(publicRow(details.publicUrl, { tone: "strong", hint: "share this" }));
        out.line();
      } else if (state === "unavailable") {
        out.settle(publicRow(`unavailable: ${details.error}`, { tone: "error" }));
        out.line(indentRow("Install cloudflared, allow npx network access, or rerun with --no-tunnel."));
        out.line();
      } else if (state === "disabled") {
        out.line(publicRow("off (--no-tunnel); only this machine can open the room"));
        out.line();
      }
    },
    viewers(count) {
      event("viewers", count ? `${count} connected` : "none connected");
    },
    comment(comment) {
      event("comment", formatCommentEvent(comment, { folder }));
    },
    review(completed) {
      event("review", `#${completed.sequence} done · ${plural(completed.summary?.comments ?? 0, "comment")}`, "success");
    },
    reload() {
      event("reload", "source changed; browsers reloading");
    },
    agentLog(message) {
      if (!muted) out.line(formatAgentLogLine(message, style, now()));
    },
    warning(message) {
      event("warning", message, "warn");
    },
    mute() {
      muted = true;
    },
    restore() {
      out.settle();
    },
    stopped(summary) {
      out.settle();
      // A TTY echoes "^C" without a newline; end that line before the summary.
      if (out.interactive) out.line();
      out.line(formatShutdownSummary(summary, style));
    },
  };
}

export function createJsonReporter({ stream = process.stdout, now = () => new Date() } = {}) {
  let muted = false;
  const write = (type, payload) => stream.write(`${JSON.stringify({ type, time: now().toISOString(), ...payload })}\n`);
  const emit = (type, payload = {}) => {
    if (!muted) write(type, payload);
  };
  return {
    mute() {
      muted = true;
    },
    startup(model) {
      emit("started", {
        version: model.version,
        target: model.targetPath,
        localUrl: model.localUrl,
        commentsPath: model.ephemeral ? null : model.commentsPath,
        sessionPath: model.sessionPath || null,
        tunnel: Boolean(model.tunnel),
        auth: Boolean(model.auth),
        ephemeral: Boolean(model.ephemeral),
        editable: Boolean(model.editable),
        theme: model.theme ? { value: model.theme.value, source: model.theme.source } : null,
        agent: model.agentMode || null,
        agentDescription: model.agent || model.agentSession?.description || null,
        commands: {
          handoff: model.handoff || null,
          tracker: model.agentSession?.tracker || null,
          record: model.agentSession?.record || null,
        },
        ...(model.sessionWarning ? { sessionWarning: model.sessionWarning } : {}),
      });
    },
    tunnel(state, details = {}) {
      emit("tunnel", { state, ...details });
    },
    viewers(count) {
      emit("viewers", { count });
    },
    comment(comment) {
      emit("comment", {
        id: comment.id,
        author: comment.author,
        authorRole: comment.authorRole,
        scope: comment.scope,
        pagePath: comment.pagePath || null,
        body: comment.body,
      });
    },
    review(completed) {
      emit("review", { sequence: completed.sequence, comments: completed.summary?.comments ?? 0 });
    },
    reload() {
      emit("reload");
    },
    agentLog(message) {
      const text = String(message);
      const match = !text.includes("\n") && text.match(/^(?:Agent inbox|Agent|Inbox):\s+(.*)$/);
      if (match) emit("agent", { message: match[1] });
      else emit("prompt", { text });
    },
    warning(message) {
      emit("warning", { message });
    },
    stopped(summary) {
      write("stopped", { elapsedMs: summary.elapsedMs, newComments: summary.newComments,
        ...(summary.signal ? { signal: summary.signal, exitCode: summary.exitCode, cleanup: summary.cleanup } : {}),
      });
      muted = true;
    },
  };
}

export function formatCommentEvent(comment, { folder = false } = {}) {
  const author = terminalText(comment.author || "Anonymous");
  const where = comment.scope === "site" ? " (site)" : folder && comment.pagePath ? ` (${terminalText(comment.pagePath)})` : "";
  return `${author}${where}: ${truncate(terminalText(comment.body || comment.quote), 72)}`;
}

// Agent worker and inbox modules log "Agent:   message" style lines; render
// single-line ones as runtime events and pass multi-line prompts through.
export function formatAgentLogLine(message, style = plainStyle, now = new Date()) {
  const text = terminalText(message, { multiline: true });
  const match = !text.includes("\n") && text.match(/^(Agent inbox|Agent|Inbox):\s+(.*)$/);
  if (!match) return text;
  return formatEvent(match[1] === "Inbox" ? "inbox" : "agent", match[2], { style, now });
}

export function formatShutdownSummary({ elapsedMs, newComments, ephemeral, commentsPath, targetPath }, style = plainStyle) {
  const duration = formatDuration(elapsedMs);
  if (ephemeral) {
    return `Stopped after ${duration} · ${plural(newComments, "comment")} discarded (in-memory session)`;
  }
  const lines = [`Stopped after ${duration} · ${plural(newComments, "new comment")} in ${terminalText(displayPath(commentsPath))}`];
  if (newComments) lines.push(`Next: tunelito inbox status ${terminalText(shellQuote(displayPath(targetPath)))}`);
  return lines.join("\n");
}

function describeLinkPreviewHeaders(headers) {
  return headers.map((header) => `${header.name}${header.env.length ? ` from ${header.env.map((name) => `\${env:${name}}`).join(", ")}` : ""}`).join(", ");
}

function publicConfigReport(config) {
  return {
    format: config.format,
    version: config.version,
    targetPath: config.targetPath,
    projectRoot: config.projectRoot,
    theme: config.theme,
    markdownCss: config.markdownCss,
    codeWrap: config.codeWrap,
    linkPreviews: config.linkPreviews,
    configFiles: {
      global: {
        path: config.configPaths.global,
        exists: existsSync(config.configPaths.global),
      },
      project: {
        path: config.configPaths.project,
        exists: existsSync(config.configPaths.project),
      },
    },
    availableThemes: config.availableThemes,
  };
}

function skillUsage() {
  return `Tunelito skill -- the distributable agent skill for coding agents.

Usage: tunelito skill <command>
       tunelito skill install --agent <codex|claude> --scope <user|project> [options]

Commands:
  tunelito skill show
              Print the Tunelito agent skill (SKILL.md) to stdout
  tunelito skill setup
              Print no-write setup guidance for common coding agents
  tunelito skill install
              Explicitly install SKILL.md at a supported discovery path
  help        Show this message

Install examples:
  tunelito skill install --agent codex --scope user --dry-run
  tunelito skill install --agent codex --scope project
  tunelito skill install --agent claude --scope user
  tunelito skill install --agent claude --scope project --force

For guided setup:
  tunelito skill setup
`;
}

function skillSetupText() {
  return `Tunelito agent setup

Version: ${VERSION}
Runtime: Node.js 22 or newer

1. Confirm Tunelito works:
   npx --yes tunelito --version

2. Print the bundled skill:
   npx --yes tunelito skill show

3. Preview and explicitly install it for your agent:

   Claude Code project skill:
     npx --yes tunelito skill install --agent claude --scope project --dry-run
     npx --yes tunelito skill install --agent claude --scope project

   Codex user skill:
     npx --yes tunelito skill install --agent codex --scope user --dry-run
     npx --yes tunelito skill install --agent codex --scope user

   Verified discovery paths:
     Codex user:   ~/.agents/skills/tunelito/SKILL.md
     Codex project: .agents/skills/tunelito/SKILL.md
     Claude user:  ~/.claude/skills/tunelito/SKILL.md
     Claude project: .claude/skills/tunelito/SKILL.md

   Cursor, Gemini, opencode, Copilot-style assistants:
     Use the same skill text as an agent instruction block or project rule according to that tool's current docs.
     Do not assume one global path is writable or loaded across machines.

4. Safety reminders:
   - Setup prints guidance only. Install writes only after an explicit agent and scope.
   - Existing files are preserved unless --force is passed; use --dry-run before writing.
   - Do not present --no-auth as local-only. For sensitive pages, use --no-tunnel, optionally with --ephemeral.
   - Treat --agent and --agent-session as trusted-session behavior because reviewer comments can become local edit instructions.
   - Flags change over time; confirm exact options with npx --yes tunelito --help before quoting them.

Full guide: https://tunelito.dev/agent-setup
Stable skill body: npx --yes tunelito skill show
`;
}

function runSkill(args, { stdout = process.stdout, stderr = process.stderr, readSkill = readBundledSkill } = {}) {
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
      return writeFailure(stderr, new Error(`Could not read the bundled Tunelito skill: ${error.message}`), { args });
    }
    stdout.write(content.endsWith("\n") ? content : `${content}\n`);
    return 0;
  }
  if (sub === "setup") {
    stdout.write(skillSetupText());
    return 0;
  }
  if (sub === "install") {
    let opts;
    try {
      // commandRunner has already normalized these tokens. Re-lexing would
      // mistake an option-like literal value for a global help/JSON flag.
      opts = parseSkillInstallOptions(args.slice(1));
    } catch (error) {
      return writeUsageFailure(stderr, error, "tunelito skill --help", args);
    }
    let content;
    try {
      content = readSkill();
    } catch (error) {
      return writeFailure(stderr, new Error(`Could not read the bundled Tunelito skill: ${error.message}`), { args });
    }
    try {
      const result = installSkill({ ...opts, content });
      stdout.write(formatSkillInstallResult(result));
      return result.action === "blocked" ? 1 : 0;
    } catch (error) {
    return writeFailure(stderr, error, { args });
    }
  }
  const suggestion = closestMatch(sub, ["show", "setup", "install"]);
  return writeUsageFailure(stderr, new UsageError(`Unknown skill command ${sub}`, {
    hint: suggestion ? `Did you mean skill ${suggestion}?` : "Skill commands: show, setup, install.",
  }), "tunelito skill --help", args);
}

function parseSkillInstallOptions(argv) {
  const opts = { force: false, dryRun: false, cwd: process.cwd(), homePath: homedir() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent") opts.agent = requiredValue(argv[++i], "--agent").toLowerCase();
    else if (arg === "--scope") opts.scope = requiredValue(argv[++i], "--scope").toLowerCase();
    else if (arg === "--project-root") opts.cwd = resolve(requiredValue(argv[++i], "--project-root", "path"));
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else throw unknownOptionError(arg, ["--agent", "--scope", "--project-root", "--dry-run", "--force"]);
  }
  if (!["codex", "claude"].includes(opts.agent)) throw new Error("--agent must be codex or claude");
  if (!["user", "project"].includes(opts.scope)) throw new Error("--scope must be user or project");
  return opts;
}

export function skillInstallDestination({ agent, scope, cwd = process.cwd(), homePath = homedir() }) {
  if (scope === "user") {
    return agent === "codex"
      ? join(resolve(homePath), ".agents", "skills", "tunelito", "SKILL.md")
      : join(resolve(homePath), ".claude", "skills", "tunelito", "SKILL.md");
  }
  const projectRoot = findProjectRoot(cwd);
  return agent === "codex"
    ? join(projectRoot, ".agents", "skills", "tunelito", "SKILL.md")
    : join(projectRoot, ".claude", "skills", "tunelito", "SKILL.md");
}

export function installSkill({ agent, scope, cwd, homePath, force = false, dryRun = false, content }) {
  const destination = skillInstallDestination({ agent, scope, cwd, homePath });
  const proposed = content.endsWith("\n") ? content : `${content}\n`;
  const exists = existsSync(destination);
  const existing = exists ? readFileSync(destination, "utf8") : "";
  const existingVersion = skillBodyVersion(existing);
  const proposedVersion = VERSION;
  let action = exists ? "blocked" : dryRun ? "would-create" : "created";
  if (exists && existing === proposed) action = "unchanged";
  else if (exists && force) action = dryRun ? "would-replace" : "replaced";

  if (!dryRun && (action === "created" || action === "replaced")) {
    atomicWriteText(destination, proposed);
  }
  return { agent, scope, destination, existingVersion, proposedVersion, action, force, dryRun };
}

function formatSkillInstallResult(result) {
  const action = result.action === "blocked"
    ? "blocked (existing file preserved; rerun with --force to replace it)"
    : result.action;
  return [
    "Tunelito skill install",
    `Agent:            ${result.agent}`,
    `Scope:            ${result.scope}`,
    `Destination:      ${result.destination}`,
    `Existing version: ${result.existingVersion || "(none or modified)"}`,
    `Proposed version: ${result.proposedVersion}`,
    `Action:           ${action}`,
    "",
  ].join("\n");
}

function skillBodyVersion(content) {
  const match = String(content || "").match(/^\s*version:\s*([^\s]+)\s*$/m);
  return match?.[1] || "";
}

function atomicWriteText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, path);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function findProjectRoot(startPath) {
  let current = resolve(startPath);
  if (existsSync(current) && statSync(current).isFile()) current = dirname(current);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(startPath);
    current = parent;
  }
}

if (isCliEntry(import.meta.url)) {
  main().catch((error) => {
    const code = writeFailure(process.stderr, error, { args: process.argv.slice(2) });
    if (!machineMode(process.argv.slice(2)) && process.env.TUNELITO_DEBUG && error?.stack) process.stderr.write(`${terminalText(error.stack, { multiline: true })}\n`);
    forceOwnedChildren();
    // An unexpected startup failure may already own a listener. Drain both
    // streams, but do not keep that failed command alive indefinitely.
    const deadline = setTimeout(() => process.exit(code), 1000);
    Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))))
      .then(() => { clearTimeout(deadline); process.exit(code); });
  });
}
