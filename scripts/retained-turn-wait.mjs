#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_AGENT_MAX_ATTEMPTS,
  DEFAULT_AGENT_MAX_PASSES,
  DEFAULT_AGENT_POLICY,
  DEFAULT_AGENT_TRIGGER,
  agentWorkspaceRoot,
  buildAgentSessionPrompt,
  defaultAgentStatePath,
  loadAgentState,
} from "../src/agent-worker.js";
import { defaultCommentsPath, loadCommentsFromMarkdown } from "../src/comments.js";
import { readSessionFile } from "../src/session.js";

const DEFAULT_TIMEOUT_SECONDS = 45;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MIN_POLL_INTERVAL_MS = 250;

export function parseRetainedTurnArgs(argv) {
  const opts = {
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    claimOwner: "agent-session",
    format: "json",
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--timeout") {
      opts.timeoutSeconds = parseInteger(argv[++i], "--timeout", 1);
    } else if (arg === "--poll-interval-ms") {
      opts.pollIntervalMs = parseInteger(argv[++i], "--poll-interval-ms", MIN_POLL_INTERVAL_MS);
    } else if (arg === "--claim-owner") {
      opts.claimOwner = requiredValue(argv[++i], "--claim-owner");
    } else if (arg === "--format") {
      opts.format = requiredValue(argv[++i], "--format");
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!opts.help && positional.length !== 1) {
    throw new Error(`Expected one HTML file, Markdown file, or folder, got ${positional.length}`);
  }
  if (!["json", "prompt"].includes(opts.format)) {
    throw new Error("--format must be json or prompt");
  }
  if (positional[0]) opts.targetPath = resolve(positional[0]);
  return opts;
}

export function inspectOwnedAgentSessionClaim(targetPath, {
  claimOwner = "agent-session",
  now = () => new Date(),
} = {}) {
  const resolvedTarget = resolve(targetPath);
  let session;
  try {
    ({ session } = readSessionFile(resolvedTarget));
  } catch (error) {
    return { status: "unavailable", reason: error.message, targetPath: resolvedTarget };
  }

  if (session.lifecycle === "stopped") {
    return { status: "stopped", reason: "session-stopped", targetPath: resolvedTarget };
  }
  const mode = session.agent?.mode || session.mode || "none";
  if (mode !== "agent-session") {
    return {
      status: "unsupported",
      reason: `session-mode-${mode}`,
      targetPath: resolvedTarget,
    };
  }

  const commentsPath = resolve(session.commentsPath || defaultCommentsPath(resolvedTarget));
  const statePath = resolve(session.statePath || session.agent?.statePath || defaultAgentStatePath(resolvedTarget));
  if (!existsSync(commentsPath)) {
    return { status: "waiting", reason: "no-comments-file", targetPath: resolvedTarget };
  }

  const checkedAt = now();
  const state = loadAgentState(statePath);
  const activeEntries = Object.entries(state.comments || {}).filter(([, item]) => (
    item?.status === "claimed"
    && item.claim?.owner === claimOwner
    && isFutureTimestamp(item.claim.expiresAt, checkedAt)
  ));
  if (!activeEntries.length) {
    return { status: "waiting", reason: "no-owned-claim", targetPath: resolvedTarget };
  }

  const claim = activeEntries[0][1].claim;
  const claimedIds = new Set(
    activeEntries
      .filter(([, item]) => item.claim.id === claim.id)
      .map(([id]) => id),
  );
  const comments = loadCommentsFromMarkdown(commentsPath).filter((comment) => claimedIds.has(comment.id));
  if (!comments.length) {
    return {
      status: "waiting",
      reason: "claimed-comments-not-visible",
      targetPath: resolvedTarget,
    };
  }

  const policy = session.agent?.policy || session.policy || DEFAULT_AGENT_POLICY;
  const trigger = session.agent?.trigger || session.trigger || DEFAULT_AGENT_TRIGGER;
  const maxAttempts = session.maxAttempts || DEFAULT_AGENT_MAX_ATTEMPTS;
  const maxPasses = session.maxPasses || DEFAULT_AGENT_MAX_PASSES;
  const workspaceRoot = session.workspaceRoot || session.sourceRoot || agentWorkspaceRoot(resolvedTarget);
  const recordCommand = session.recordCommand
    || `tunelito inbox record ${JSON.stringify(resolvedTarget)} --id <comment-id> --status <status> --summary "<short summary>"`;
  const prompt = buildAgentSessionPrompt({
    comments,
    commentsPath,
    targetPath: resolvedTarget,
    workspaceRoot,
    statePath,
    trigger,
    policy,
    maxAttempts,
    maxPasses,
    ownerName: session.ownerName || "",
    recordCommand,
    claim,
  });

  return {
    status: "claimed",
    reason: "owned-claim-ready",
    targetPath: resolvedTarget,
    commentsPath,
    statePath,
    claim,
    commentIds: comments.map((comment) => comment.id),
    prompt,
  };
}

export async function waitForOwnedAgentSessionClaim(targetPath, {
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  claimOwner = "agent-session",
  signal,
  now = () => new Date(),
} = {}) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error("--timeout must be a positive integer");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    throw new Error(`--poll-interval-ms must be at least ${MIN_POLL_INTERVAL_MS}`);
  }

  const startedAt = Date.now();
  while (true) {
    if (signal?.aborted) {
      return { status: "interrupted", reason: "aborted", targetPath: resolve(targetPath) };
    }
    const result = inspectOwnedAgentSessionClaim(targetPath, { claimOwner, now });
    if (result.status !== "waiting") return result;
    if (Date.now() - startedAt >= timeoutSeconds * 1_000) {
      return { ...result, status: "timeout", reason: "timeout" };
    }
    await abortableDelay(pollIntervalMs, signal);
  }
}

export async function runRetainedTurnWait(argv, {
  stdout = process.stdout,
  stderr = process.stderr,
  signal,
} = {}) {
  let opts;
  try {
    opts = parseRetainedTurnArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n\n${usage()}`);
    return 1;
  }
  if (opts.help) {
    stdout.write(usage());
    return 0;
  }

  try {
    const result = await waitForOwnedAgentSessionClaim(opts.targetPath, {
      timeoutSeconds: opts.timeoutSeconds,
      pollIntervalMs: opts.pollIntervalMs,
      claimOwner: opts.claimOwner,
      signal,
    });
    if (opts.format === "prompt") {
      if (result.prompt) stdout.write(result.prompt);
      else stdout.write(`Tunelito retained-turn wait ended: ${result.status} (${result.reason}).\n`);
    } else {
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return result.status === "interrupted" ? 130 : 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

function abortableDelay(ms, signal) {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolveDelay();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function isFutureTimestamp(value, now) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function parseInteger(value, name, min) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${name} must be an integer of at least ${min}`);
  }
  return number;
}

function requiredValue(value, name) {
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function usage() {
  return `Retained-turn prototype

Usage:
  node scripts/retained-turn-wait.mjs <target> [options]

Options:
  --timeout <seconds>       Bounded wait (default: ${DEFAULT_TIMEOUT_SECONDS})
  --poll-interval-ms <ms>   Read-only polling interval (default: ${DEFAULT_POLL_INTERVAL_MS})
  --claim-owner <name>      Claim owner to observe (default: agent-session)
  --format <json|prompt>    Output format (default: json)

This script never claims or records comments. Start the target with
--agent-session first so Tunelito remains the single workspace claimer.
`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  process.exitCode = await runRetainedTurnWait(process.argv.slice(2), { signal: controller.signal });
}
