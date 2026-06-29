import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadCommentsFromMarkdown } from "./comments.js";

export const DEFAULT_AGENT_INTERVAL_SECONDS = 120;
export const DEFAULT_AGENT_TRIGGER = "all";
export const DEFAULT_AGENT_POLICY = "all";
export const AGENT_POLICIES = ["all", "mention", "owner", "owner-or-mention"];
export const DEFAULT_AGENT_MAX_ATTEMPTS = 2;
export const DEFAULT_AGENT_MAX_PASSES = 3;
export const DEFAULT_INBOX_CLAIM_SECONDS = 900;
export const DEFAULT_INBOX_WAIT_INTERVAL_SECONDS = 5;

const STATE_VERSION = 1;
const AGENT_POLICY_SET = new Set(AGENT_POLICIES);
const TERMINAL_STATUSES = new Set(["resolved", "no-op", "blocked", "stale", "ignored", "partial", "changed_needs_review"]);
const RESULT_STATUSES = new Set(["resolved", "no-op", "blocked", "stale", "ignored", "partial", "needs_followup"]);
const CAPTURE_LIMIT = 200_000;

export function createAgentWorker({
  provider,
  command,
  commentsPath,
  targetPath,
  statePath,
  intervalSeconds = DEFAULT_AGENT_INTERVAL_SECONDS,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend = "",
  promptOverride = "",
  spawnFn = spawn,
  now = () => new Date(),
  log = console.log,
} = {}) {
  const config = normalizeAgentConfig({ provider, command, commentsPath, targetPath, statePath, intervalSeconds, trigger, policy, maxAttempts, maxPasses, ownerName, promptAppend, promptOverride });
  let timer = null;
  let running = false;
  let stopped = false;
  let currentChild = null;
  let commentsWatcher = null;

  async function runOnce(reason = "manual") {
    if (running || stopped) return { skipped: true, reason: running ? "running" : "stopped" };
    running = true;
    try {
      return await runAgentPass({
        ...config,
        reason,
        spawnFn: wrapSpawn(spawnFn, (child) => {
          currentChild = child;
          child.once("close", () => {
            if (currentChild === child) currentChild = null;
          });
        }),
        now,
        log,
      });
    } finally {
      running = false;
    }
  }

  function schedule(delayMs) {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      await runOnce("interval");
      schedule(config.intervalSeconds * 1000);
    }, delayMs);
    timer.unref?.();
  }

  function wake(reason = "comment") {
    if (stopped) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(async () => {
      timer = null;
      await runOnce(reason);
      schedule(config.intervalSeconds * 1000);
    }, 500);
    timer.unref?.();
  }

  function startCommentsWatcher() {
    if (commentsWatcher || stopped || !config.commentsPath) return;
    try {
      commentsWatcher = watch(dirname(config.commentsPath), { persistent: true }, (_eventType, filename) => {
        if (isWatchedCommentsFilename(filename, config.commentsPath)) wake("comments-file");
      });
      commentsWatcher.unref?.();
    } catch (error) {
      log(`Agent:   comments file watch unavailable (${error.message}); using interval fallback`);
    }
  }

  return {
    ...config,
    description: describeAgentConfig(config),
    start() {
      startCommentsWatcher();
      schedule(0);
    },
    wake,
    async runOnce(reason) {
      return runOnce(reason);
    },
    async stop() {
      stopped = true;
      commentsWatcher?.close();
      commentsWatcher = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (currentChild && !currentChild.killed) currentChild.kill("SIGTERM");
    },
  };
}

export async function runAgentPass({
  provider,
  command,
  commentsPath,
  targetPath,
  workspaceRoot,
  statePath,
  logPath,
  trigger,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend,
  promptOverride,
  reason = "manual",
  spawnFn = spawn,
  now = () => new Date(),
  log = console.log,
} = {}) {
  workspaceRoot = workspaceRoot || (targetPath ? agentWorkspaceRoot(targetPath) : null);
  statePath = statePath || (targetPath ? defaultAgentStatePath(targetPath) : null);
  logPath = logPath || (statePath ? defaultAgentLogPath(statePath) : null);
  if (!commentsPath || !existsSync(commentsPath)) return { processed: 0, reason: "no-comments-file" };
  if (!workspaceRoot || !statePath || !logPath) throw new Error("agent pass requires targetPath or explicit workspaceRoot, statePath, and logPath");

  let state;
  try {
    state = loadAgentState(statePath);
  } catch (error) {
    log(`Agent:   state unavailable (${error.message}); skipping this pass`);
    return { processed: 0, reason: "invalid-state" };
  }

  const comments = loadCommentsFromMarkdown(commentsPath);
  const prepared = prepareAgentQueue(comments, state, { trigger, policy, maxAttempts, maxPasses, now });
  if (prepared.changed) saveAgentState(statePath, state, now);
  if (!prepared.pending.length) return { processed: 0, reason: "no-pending-comments" };

  const runId = `run_${now().getTime().toString(36)}`;
  const startedAt = now().toISOString();
  const priorStatesById = Object.fromEntries(prepared.pending.map((item) => [item.comment.id, state.comments[item.comment.id] || null]));
  for (const item of prepared.pending) {
    const existing = state.comments[item.comment.id] || {};
    const attempts = Number(existing.attempts || 0) + 1;
    state.comments[item.comment.id] = {
      ...existing,
      id: item.comment.id,
      fingerprint: item.fingerprint,
      status: "in_progress",
      attempts,
      previousStatus: existing.status || null,
      pagePath: item.comment.pagePath || "",
      quote: preview(item.comment.quote),
      body: preview(item.comment.body),
      startedAt,
      updatedAt: startedAt,
      runId,
    };
  }
  saveAgentState(statePath, state, now);

  const prompt = buildAgentPrompt({
    comments: prepared.pending.map((item) => item.comment),
    commentsPath,
    workspaceRoot,
    statePath,
    trigger,
    policy,
    maxAttempts,
    maxPasses,
    ownerName,
    commentStates: priorStatesById,
    promptAppend,
    promptOverride,
  });

  let commandResult;
  try {
    commandResult = await runAgentCommand({
      provider,
      command,
      workspaceRoot,
      commentsPath,
      statePath,
      ownerName,
      prompt,
      spawnFn,
    });
  } catch (error) {
    const failedAt = now().toISOString();
    for (const item of prepared.pending) {
      markRetryOrBlocked(state, item.comment, item.fingerprint, {
        now: failedAt,
        maxAttempts,
        error: error.message,
      });
    }
    saveAgentState(statePath, state, now);
    appendAgentLog(logPath, {
      runId,
      provider,
      reason,
      startedAt,
      finishedAt: failedAt,
      comments: prepared.pending.map((item) => item.comment),
      error: error.message,
    });
    log(`Agent:   failed to run ${provider} (${error.message})`);
    return { processed: prepared.pending.length, failed: prepared.pending.length };
  }

  const finishedAt = now().toISOString();
  let parsed;
  try {
    parsed = parseAgentResult(commandResult.output);
  } catch (error) {
    for (const item of prepared.pending) {
      markBlocked(state, item.comment, item.fingerprint, {
        now: finishedAt,
        error: `Agent output was not valid JSON: ${error.message}`,
      });
    }
    saveAgentState(statePath, state, now);
    appendAgentLog(logPath, {
      runId,
      provider,
      reason,
      startedAt,
      finishedAt,
      comments: prepared.pending.map((item) => item.comment),
      output: commandResult.output,
      error: error.message,
    });
    log("Agent:   output was not valid JSON; marked comments blocked");
    return { processed: prepared.pending.length, blocked: prepared.pending.length };
  }

  const resultsById = new Map(parsed.comments.map((result) => [result.id, result]));
  const statuses = {};
  for (const item of prepared.pending) {
    const result = resultsById.get(item.comment.id);
    if (!result) {
      markRetryOrBlocked(state, item.comment, item.fingerprint, {
        now: finishedAt,
        maxAttempts,
        error: "Agent did not return a result for this comment id.",
      });
      statuses[item.comment.id] = state.comments[item.comment.id].status;
      continue;
    }
    markResult(state, item.comment, item.fingerprint, result, { now: finishedAt, maxPasses });
    statuses[item.comment.id] = state.comments[item.comment.id].status;
  }

  saveAgentState(statePath, state, now);
  appendAgentLog(logPath, {
    runId,
    provider,
    reason,
    startedAt,
    finishedAt,
    comments: prepared.pending.map((item) => item.comment),
    results: parsed.comments,
    exitCode: commandResult.exitCode,
  });

  const resolvedCount = Object.values(statuses).filter((status) => status === "resolved" || status === "no-op").length;
  log(`Agent:   processed ${prepared.pending.length} comment${prepared.pending.length === 1 ? "" : "s"} (${resolvedCount} resolved/no-op)`);
  return { processed: prepared.pending.length, statuses };
}

export function normalizeAgentConfig({
  provider,
  command,
  commentsPath,
  targetPath,
  statePath,
  intervalSeconds = DEFAULT_AGENT_INTERVAL_SECONDS,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend = "",
  promptOverride = "",
} = {}) {
  const normalizedProvider = command && !provider ? "custom" : String(provider || "").trim().toLowerCase();
  if (!normalizedProvider) throw new Error("--agent requires a provider such as codex or claude");
  if (!["codex", "claude", "custom"].includes(normalizedProvider)) {
    throw new Error(`Unsupported --agent provider: ${provider}. Use codex, claude, or --agent-command for custom CLIs.`);
  }
  if (command && normalizedProvider !== "custom") throw new Error("--agent-command can only be used with --agent custom");
  if (normalizedProvider === "custom" && !command) throw new Error("--agent custom requires --agent-command");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) throw new Error("--agent-interval must be a positive number of seconds");
  const shared = normalizeAgentWorkspaceConfig({
    commentsPath,
    targetPath,
    statePath,
    trigger,
    policy,
    maxAttempts,
    maxPasses,
    ownerName,
    promptAppend,
    usage: "--agent",
  });
  return {
    provider: normalizedProvider,
    command: command || "",
    ...shared,
    intervalSeconds,
    promptOverride: normalizePromptText(promptOverride),
  };
}

export function normalizeAgentInboxConfig({
  commentsPath,
  targetPath,
  statePath,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend = "",
  claimOwner = "agent-session",
  claimSeconds = DEFAULT_INBOX_CLAIM_SECONDS,
} = {}) {
  const shared = normalizeAgentWorkspaceConfig({
    commentsPath,
    targetPath,
    statePath,
    trigger,
    policy,
    maxAttempts,
    maxPasses,
    ownerName,
    promptAppend,
    claimSeconds,
    usage: "inbox commands",
  });
  return {
    ...shared,
    claimOwner: cleanClaimOwner(claimOwner),
    claimSeconds,
  };
}

function normalizeAgentWorkspaceConfig({
  commentsPath,
  targetPath,
  statePath,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend = "",
  claimSeconds = null,
  usage = "agent config",
} = {}) {
  if (!commentsPath) throw new Error(`${usage} requires persistent comments; remove --live`);
  if (!targetPath) throw new Error(`${usage} requires a target HTML, Markdown, or folder path`);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("--agent-max-attempts must be a positive integer");
  if (!Number.isInteger(maxPasses) || maxPasses < 1) throw new Error("--agent-max-passes must be a positive integer");
  if (claimSeconds !== null && (!Number.isInteger(claimSeconds) || claimSeconds < 1)) throw new Error("--claim-ttl must be a positive integer");
  const normalizedPolicy = normalizeAgentPolicy(policy);
  const normalizedTrigger = trigger || DEFAULT_AGENT_TRIGGER;
  if (requiresMentionTrigger(normalizedPolicy) && isAllTrigger(normalizedTrigger)) {
    throw new Error(`--agent-policy ${normalizedPolicy} requires --agent-trigger with a marker such as @agent`);
  }

  const workspaceRoot = agentWorkspaceRoot(targetPath);
  const resolvedStatePath = resolve(statePath || defaultAgentStatePath(targetPath));
  return {
    commentsPath: resolve(commentsPath),
    targetPath: resolve(targetPath),
    workspaceRoot,
    statePath: resolvedStatePath,
    logPath: defaultAgentLogPath(resolvedStatePath),
    trigger: normalizedTrigger,
    policy: normalizedPolicy,
    maxAttempts,
    maxPasses,
    ownerName: cleanOwnerName(ownerName),
    promptAppend: normalizePromptText(promptAppend),
  };
}

export function agentWorkspaceRoot(targetPath) {
  const resolved = resolve(targetPath);
  const stats = statSync(resolved);
  return stats.isDirectory() ? resolved : dirname(resolved);
}

export function defaultAgentStatePath(targetPath) {
  return join(agentWorkspaceRoot(targetPath), ".tunelito", "agent", "state.json");
}

export function defaultAgentLogPath(statePath) {
  return join(dirname(resolve(statePath)), "log.md");
}

export function loadAgentState(statePath) {
  if (!existsSync(statePath)) return emptyAgentState();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  return {
    version: state.version || STATE_VERSION,
    updatedAt: state.updatedAt || null,
    comments: state.comments && typeof state.comments === "object" ? state.comments : {},
  };
}

export function saveAgentState(statePath, state, now = () => new Date()) {
  mkdirSync(dirname(statePath), { recursive: true });
  const nextState = {
    version: STATE_VERSION,
    updatedAt: now().toISOString(),
    comments: state.comments && typeof state.comments === "object" ? state.comments : {},
  };
  const temp = `${statePath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  renameSync(temp, statePath);
}

export function prepareAgentQueue(comments, state, { trigger = DEFAULT_AGENT_TRIGGER, policy = DEFAULT_AGENT_POLICY, maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS, maxPasses = DEFAULT_AGENT_MAX_PASSES, now = () => new Date() } = {}) {
  const pending = [];
  let changed = false;
  const normalizedPolicy = normalizeAgentPolicy(policy);
  const checkedAt = now();
  for (const comment of comments) {
    if (!comment?.id) continue;
    const fingerprint = fingerprintComment(comment);
    const existing = state.comments[comment.id];

    if (existing?.fingerprint && existing.fingerprint !== fingerprint) {
      if (isTerminalStatus(existing.status)) {
        state.comments[comment.id] = {
          ...existing,
          fingerprint,
          status: "changed_needs_review",
          claim: undefined,
          changedAt: checkedAt.toISOString(),
          updatedAt: checkedAt.toISOString(),
        };
        changed = true;
        continue;
      }
    }

    if (isTerminalStatus(existing?.status)) continue;
    if (hasActiveClaim(existing, checkedAt)) continue;
    if (existing?.status === "needs_followup" && Number(existing?.passes || 0) >= maxPasses) {
      markPassLimitPartial(state, comment, fingerprint, {
        now: checkedAt.toISOString(),
        maxPasses,
      });
      changed = true;
      continue;
    }
    if (failureAttempts(existing) >= maxAttempts) {
      markBlocked(state, comment, fingerprint, {
        now: checkedAt.toISOString(),
        error: `Attempt limit reached (${maxAttempts}).`,
      });
      changed = true;
      continue;
    }
    if (!commentMatchesAgentPolicy(comment, { policy: normalizedPolicy, trigger })) continue;
    pending.push({ comment, fingerprint });
  }
  return { pending, changed };
}

export function claimNextAgentComments({
  commentsPath,
  targetPath,
  statePath,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend = "",
  claimOwner = "agent-session",
  claimSeconds = DEFAULT_INBOX_CLAIM_SECONDS,
  limit = 1,
  recordCommand = "",
  now = () => new Date(),
} = {}) {
  const config = normalizeAgentInboxConfig({
    commentsPath,
    targetPath,
    statePath,
    trigger,
    policy,
    maxAttempts,
    maxPasses,
    ownerName,
    promptAppend,
    claimOwner,
    claimSeconds,
  });
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  if (!existsSync(config.commentsPath)) return { ...config, comments: [], prompt: "", reason: "no-comments-file" };

  const state = loadAgentState(config.statePath);
  const comments = loadCommentsFromMarkdown(config.commentsPath);
  const prepared = prepareAgentQueue(comments, state, {
    trigger: config.trigger,
    policy: config.policy,
    maxAttempts: config.maxAttempts,
    maxPasses: config.maxPasses,
    now,
  });
  if (prepared.changed) saveAgentState(config.statePath, state, now);
  if (!prepared.pending.length) return { ...config, comments: [], prompt: "", reason: "no-pending-comments" };

  const claimedAt = now();
  const expiresAt = new Date(claimedAt.getTime() + config.claimSeconds * 1000);
  const claimId = `claim_${claimedAt.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const claimed = prepared.pending.slice(0, limit);
  const priorStatesById = Object.fromEntries(claimed.map((item) => [item.comment.id, state.comments[item.comment.id] || null]));

  for (const item of claimed) {
    const existing = state.comments[item.comment.id] || {};
    state.comments[item.comment.id] = {
      ...existing,
      id: item.comment.id,
      fingerprint: item.fingerprint,
      status: "claimed",
      previousStatus: existing.status || null,
      pagePath: item.comment.pagePath || "",
      quote: preview(item.comment.quote),
      body: preview(item.comment.body),
      claim: {
        id: claimId,
        owner: config.claimOwner,
        claimedAt: claimedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      updatedAt: claimedAt.toISOString(),
    };
  }
  saveAgentState(config.statePath, state, now);

  const claimedComments = claimed.map((item) => item.comment);
  const prompt = buildAgentSessionPrompt({
    comments: claimedComments,
    commentsPath: config.commentsPath,
    targetPath: config.targetPath,
    workspaceRoot: config.workspaceRoot,
    statePath: config.statePath,
    trigger: config.trigger,
    policy: config.policy,
    maxAttempts: config.maxAttempts,
    maxPasses: config.maxPasses,
    ownerName: config.ownerName,
    commentStates: priorStatesById,
    promptAppend: config.promptAppend,
    recordCommand,
    claim: {
      id: claimId,
      owner: config.claimOwner,
      claimedAt: claimedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    ...config,
    comments: claimedComments,
    prompt,
    reason: "claimed",
    claim: {
      id: claimId,
      owner: config.claimOwner,
      claimedAt: claimedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export function createAgentSessionWatcher({
  commentsPath,
  targetPath,
  statePath,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  ownerName = "",
  promptAppend = "",
  claimOwner = "agent-session",
  claimSeconds = DEFAULT_INBOX_CLAIM_SECONDS,
  waitIntervalSeconds = DEFAULT_INBOX_WAIT_INTERVAL_SECONDS,
  limit = 1,
  recordCommand = "",
  now = () => new Date(),
  log = console.log,
} = {}) {
  const config = normalizeAgentInboxConfig({
    commentsPath,
    targetPath,
    statePath,
    trigger,
    policy,
    maxAttempts,
    maxPasses,
    ownerName,
    promptAppend,
    claimOwner,
    claimSeconds,
  });
  if (!Number.isInteger(waitIntervalSeconds) || waitIntervalSeconds < 1) throw new Error("--wait-interval must be a positive integer");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");

  let timer = null;
  let running = false;
  let stopped = false;
  let commentsWatcher = null;

  async function runOnce(reason = "manual") {
    if (running || stopped) return { skipped: true, reason: running ? "running" : "stopped" };
    running = true;
    try {
      if (hasActiveClaimForOwner({
        commentsPath: config.commentsPath,
        statePath: config.statePath,
        claimOwner: config.claimOwner,
        now: now(),
      })) {
        return { ...config, comments: [], prompt: "", reason: "active-claim" };
      }

      const result = claimNextAgentComments({
        ...config,
        limit,
        recordCommand,
        now,
      });
      if (result.comments.length) log(formatAgentSessionClaim(result));
      return result;
    } catch (error) {
      log(`Agent inbox: ${error.message}`);
      return { ...config, comments: [], prompt: "", reason: "error", error };
    } finally {
      running = false;
    }
  }

  function schedule(delayMs) {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      await runOnce("interval");
      schedule(waitIntervalSeconds * 1000);
    }, delayMs);
    timer.unref?.();
  }

  function wake(reason = "comment") {
    if (stopped) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(async () => {
      timer = null;
      await runOnce(reason);
      schedule(waitIntervalSeconds * 1000);
    }, 500);
    timer.unref?.();
  }

  function startCommentsWatcher() {
    if (commentsWatcher || stopped || !config.commentsPath) return;
    try {
      commentsWatcher = watch(dirname(config.commentsPath), { persistent: true }, (_eventType, filename) => {
        if (isWatchedCommentsFilename(filename, config.commentsPath)) wake("comments-file");
      });
      commentsWatcher.unref?.();
    } catch (error) {
      log(`Agent inbox: comments file watch unavailable (${error.message}); using interval fallback`);
    }
  }

  return {
    ...config,
    description: describeAgentSessionConfig(config),
    start() {
      startCommentsWatcher();
      schedule(0);
    },
    wake,
    async runOnce(reason) {
      return runOnce(reason);
    },
    async stop() {
      stopped = true;
      commentsWatcher?.close();
      commentsWatcher = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export async function waitForAgentInboxComments({
  waitIntervalSeconds = DEFAULT_INBOX_WAIT_INTERVAL_SECONDS,
  timeoutSeconds = 0,
  log = () => {},
  ...options
} = {}) {
  if (!Number.isInteger(waitIntervalSeconds) || waitIntervalSeconds < 1) throw new Error("--wait-interval must be a positive integer");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0) throw new Error("--timeout must be a non-negative integer");

  let first = claimNextAgentComments(options);
  if (first.comments.length) return first;

  return await new Promise((resolveWait) => {
    let settled = false;
    let commentsWatcher = null;
    let fallbackTimer = null;
    let timeoutTimer = null;

    function cleanup() {
      if (settled) return false;
      settled = true;
      commentsWatcher?.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      return true;
    }

    function finish(result) {
      if (!cleanup()) return;
      resolveWait(result);
    }

    function check() {
      if (settled) return;
      const result = claimNextAgentComments(options);
      if (result.comments.length) finish(result);
      first = result;
    }

    try {
      commentsWatcher = watch(dirname(first.commentsPath), { persistent: true }, (_eventType, filename) => {
        if (isWatchedCommentsFilename(filename, first.commentsPath)) check();
      });
    } catch (error) {
      log(`Inbox:   comments file watch unavailable (${error.message}); using interval fallback`);
    }

    fallbackTimer = setInterval(check, waitIntervalSeconds * 1000);
    if (timeoutSeconds > 0) {
      timeoutTimer = setTimeout(() => finish({ ...first, comments: [], prompt: "", reason: "timeout" }), timeoutSeconds * 1000);
    }
  });
}

export function recordAgentSessionResult({
  commentsPath,
  targetPath,
  statePath,
  result,
  claimId = "",
  maxPasses = DEFAULT_AGENT_MAX_PASSES,
  now = () => new Date(),
  provider = "agent-session",
} = {}) {
  const config = normalizeAgentInboxConfig({
    commentsPath,
    targetPath,
    statePath,
    maxPasses,
  });
  if (!existsSync(config.commentsPath)) throw new Error(`Comments file not found: ${config.commentsPath}`);
  const state = loadAgentState(config.statePath);
  const comments = loadCommentsFromMarkdown(config.commentsPath);
  const normalized = normalizeResultPayload({ comments: [result] });
  const normalizedResult = normalized.comments[0];
  if (!normalizedResult) throw new Error("No valid result to record");

  const comment = comments.find((item) => item.id === normalizedResult.id);
  if (!comment) throw new Error(`Comment not found: ${normalizedResult.id}`);

  const finishedAtDate = now();
  const existing = state.comments[comment.id] || {};
  const activeClaim = existing.claim && hasActiveClaim(existing, finishedAtDate) ? existing.claim : null;
  const effectiveClaimId = claimId === "auto" ? (activeClaim?.id || "") : claimId;
  if (activeClaim && !effectiveClaimId) {
    throw new Error(`Comment ${comment.id} is claimed by ${existing.claim.owner}; rerun inbox watch or pass --claim ${existing.claim.id}`);
  }
  if (effectiveClaimId && existing.claim?.id !== effectiveClaimId) {
    const owner = existing.claim?.owner || "unknown owner";
    const current = existing.claim?.id
      ? `; current claim is ${existing.claim.id} by ${owner}`
      : "; it is not currently claimed";
    throw new Error(`Comment ${comment.id} is not claimed by ${effectiveClaimId}${current}`);
  }

  const finishedAt = finishedAtDate.toISOString();
  const fingerprint = fingerprintComment(comment);
  markResult(state, comment, fingerprint, normalizedResult, { now: finishedAt, maxPasses: config.maxPasses });
  saveAgentState(config.statePath, state, now);
  appendAgentLog(config.logPath, {
    runId: `record_${now().getTime().toString(36)}`,
    provider,
    reason: "record",
    startedAt: finishedAt,
    finishedAt,
    comments: [comment],
    results: [normalizedResult],
  });

  return {
    ...config,
    comment,
    result: normalizedResult,
    state: state.comments[comment.id],
  };
}

export function formatAgentTodoTracker({
  commentsPath,
  targetPath,
  statePath,
  trigger = DEFAULT_AGENT_TRIGGER,
  policy = DEFAULT_AGENT_POLICY,
  now = () => new Date(),
} = {}) {
  const config = normalizeAgentInboxConfig({
    commentsPath,
    targetPath,
    statePath,
    trigger,
    policy,
  });
  const state = loadAgentState(config.statePath);
  const comments = existsSync(config.commentsPath) ? loadCommentsFromMarkdown(config.commentsPath) : [];
  const snapshot = buildAgentStatusSnapshot({
    comments: comments.filter((comment) => comment?.id && commentMatchesAgentPolicy(comment, { policy: config.policy, trigger: config.trigger })),
    state,
    now,
  });
  const visible = Object.values(snapshot.comments);

  const lines = ["Tunelito To Do"];
  if (!visible.length) {
    lines.push("", "No actionable comments match the current agent policy.");
    return `${lines.join("\n")}\n`;
  }

  for (const item of visible) {
    lines.push("", `## ${item.id} - ${item.status}`);
    if (item.claim?.id) {
      const claimState = item.claim.active ? "active" : "expired";
      const owner = item.claim.owner || "unknown owner";
      const expires = item.claim.expiresAt ? `; expires ${item.claim.expiresAt}` : "";
      lines.push(`Claim: ${item.claim.id} by ${owner} (${claimState}${expires})`);
    }
    for (const done of item.done) lines.push(`- [x] ~~${done}~~`);
    for (const todo of item.todo) lines.push(`- [ ] ${todo}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildAgentStatusSnapshot({ comments = [], state = emptyAgentState(), now = () => new Date() } = {}) {
  const checkedAt = now();
  const statuses = {};
  for (const comment of comments) {
    if (!comment?.id) continue;
    statuses[comment.id] = formatAgentWorkStatus(comment, state.comments?.[comment.id], checkedAt);
  }
  return {
    version: 1,
    updatedAt: state.updatedAt || null,
    generatedAt: checkedAt.toISOString(),
    comments: statuses,
  };
}

export function summarizeAgentStatusSnapshot(snapshot) {
  const comments = snapshot?.comments && typeof snapshot.comments === "object" ? snapshot.comments : {};
  const byStatus = {};
  let unhandled = 0;
  let completed = 0;
  for (const item of Object.values(comments)) {
    const status = item?.status || "pending";
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (isTerminalStatus(status)) completed += 1;
    else unhandled += 1;
  }
  return {
    total: Object.keys(comments).length,
    pending: byStatus.pending || 0,
    unhandled,
    completed,
    byStatus,
  };
}

export function fingerprintComment(comment) {
  const payload = {
    scope: comment.scope || "page",
    pagePath: comment.pagePath || "",
    quote: comment.quote || "",
    body: comment.body || "",
    created: comment.created || "",
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function commentMatchesTrigger(comment, trigger = DEFAULT_AGENT_TRIGGER) {
  if (isAllTrigger(trigger)) return true;
  const text = `${comment.body || ""}\n${comment.quote || ""}`;
  return text.toLowerCase().includes(String(trigger).toLowerCase());
}

export function commentMatchesAgentPolicy(comment, { policy = DEFAULT_AGENT_POLICY, trigger = DEFAULT_AGENT_TRIGGER } = {}) {
  const normalizedPolicy = normalizeAgentPolicy(policy);
  if (normalizedPolicy === "owner") return isOwnerComment(comment) || isOwnerApprovedComment(comment);
  if (normalizedPolicy === "mention") return !isAllTrigger(trigger) && commentMatchesTrigger(comment, trigger);
  if (normalizedPolicy === "owner-or-mention") {
    return isOwnerComment(comment) || isOwnerApprovedComment(comment) || (!isAllTrigger(trigger) && commentMatchesTrigger(comment, trigger));
  }
  return commentMatchesTrigger(comment, trigger);
}

export function normalizeAgentPolicy(policy = DEFAULT_AGENT_POLICY) {
  const normalized = String(policy || DEFAULT_AGENT_POLICY).trim().toLowerCase();
  if (!AGENT_POLICY_SET.has(normalized)) {
    throw new Error(`Unsupported --agent-policy: ${policy}. Use ${AGENT_POLICIES.join(", ")}.`);
  }
  return normalized;
}

export function isWatchedCommentsFilename(filename, commentsPath) {
  if (!filename) return true;
  const value = basename(String(filename));
  const commentsFile = basename(commentsPath);
  return value === commentsFile || value === `${commentsFile}.tmp`;
}

export function buildAgentPrompt({ comments, commentsPath, workspaceRoot, statePath, trigger, policy = DEFAULT_AGENT_POLICY, maxAttempts, maxPasses = DEFAULT_AGENT_MAX_PASSES, ownerName = "", commentStates = {}, promptAppend = "", promptOverride = "" }) {
  const behavior = normalizePromptText(promptOverride) || defaultAgentBehaviorPrompt();
  const hostInstructions = normalizePromptText(promptAppend);
  const owner = cleanOwnerName(ownerName);
  const normalizedPolicy = normalizeAgentPolicy(policy);
  const sections = [
    behavior,
    hostInstructions ? `## Host Instructions\n\n${hostInstructions}` : "",
    `## Workspace

- Source root: ${workspaceRoot}
- Comments inbox: ${commentsPath}
- Resolution ledger: ${statePath}
- Policy: ${normalizedPolicy}
- Trigger: ${trigger}
- Max retry attempts per comment: ${maxAttempts}
- Max passes per comment: ${maxPasses}${owner ? `\n- Owner: ${owner}` : ""}`,
    `## Output Contract

Return only JSON as your final response. Do not wrap it in Markdown. Use this shape:

{
  "comments": [
    {
      "id": "comment id",
      "status": "resolved | no-op | blocked | stale | ignored | partial | needs_followup",
      "summary": "short description",
      "filesChanged": ["relative/path.html"],
      "completedTasks": ["work completed this pass"],
      "remainingTasks": ["specific work to continue on a later pass"]
    }
  ]
}`,
    `## Comments To Address

${JSON.stringify(comments.map((comment) => formatCommentForPrompt(comment, commentStates[comment.id], { maxPasses })), null, 2)}`,
  ].filter(Boolean);

  return `${sections.join("\n\n")}\n`;
}

export function buildAgentSessionPrompt({ comments, commentsPath, targetPath, workspaceRoot, statePath, trigger, policy = DEFAULT_AGENT_POLICY, maxAttempts, maxPasses = DEFAULT_AGENT_MAX_PASSES, ownerName = "", commentStates = {}, promptAppend = "", recordCommand = "", claim = null }) {
  const hostInstructions = normalizePromptText(promptAppend);
  const owner = cleanOwnerName(ownerName);
  const normalizedPolicy = normalizeAgentPolicy(policy);
  let command = normalizePromptText(recordCommand) || `tunelito inbox record ${JSON.stringify(targetPath)} --id <comment-id> --status <status> --summary "<short summary>" --file <relative/path.html>`;
  if (claim && !/\s--claim(?:\s|$)/.test(command)) command = `${command} --claim ${claim.id}`;
  const sections = [
    `# Tunelito Agent Session Inbox

You are the active coding agent for a Tunelito review session. Tunelito has claimed the comments below for this session; edit the served source files directly, then record the outcome with \`tunelito inbox record\`.`,
    hostInstructions ? `## Host Instructions\n\n${hostInstructions}` : "",
    `## Workspace

- Source root: ${workspaceRoot}
- Target: ${targetPath}
- Comments inbox: ${commentsPath}
- Resolution ledger: ${statePath}
- Policy: ${normalizedPolicy}
- Trigger: ${trigger}
- Max retry attempts per comment: ${maxAttempts}
- Max passes per comment: ${maxPasses}${owner ? `\n- Owner: ${owner}` : ""}${claim ? `\n- Claim: ${claim.id} for ${claim.owner}, expires ${claim.expiresAt}` : ""}`,
    `## Workflow

1. Read each comment's scope, pagePath, quote, body, and continuation context.
2. Edit only the local source files needed to satisfy the comment.
3. Do not edit the comments inbox or the resolution ledger directly.
4. After handling each comment, run:

\`\`\`bash
${command}
\`\`\`

Allowed statuses: resolved, no-op, blocked, stale, ignored, partial, needs_followup.
Use repeated \`--file\`, \`--completed\`, and \`--remaining\` flags when useful. Use \`needs_followup\` only when you made concrete progress and can name the remaining tasks.`,
    `## Comments To Address

${JSON.stringify(comments.map((comment) => formatCommentForPrompt(comment, commentStates[comment.id], { maxPasses })), null, 2)}`,
  ].filter(Boolean);

  return `${sections.join("\n\n")}\n`;
}

export async function runAgentCommand({ provider, command, workspaceRoot, commentsPath, statePath, ownerName = "", prompt, spawnFn = spawn }) {
  const env = {
    ...process.env,
    TUNELITO_AGENT: provider,
    TUNELITO_AGENT_COMMENTS: commentsPath,
    TUNELITO_AGENT_STATE: statePath,
    TUNELITO_AGENT_ROOT: workspaceRoot,
    TUNELITO_OWNER_NAME: cleanOwnerName(ownerName),
  };
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-agent-"));
  try {
    let child;
    let outputFile = null;
    if (provider === "codex") {
      outputFile = join(tempDir, "codex-last-message.txt");
      child = spawnFn("codex", [
        "exec",
        "-C",
        workspaceRoot,
        "--skip-git-repo-check",
        "-s",
        "workspace-write",
        "-o",
        outputFile,
        "-",
      ], { cwd: workspaceRoot, env, stdio: ["pipe", "pipe", "pipe"] });
    } else if (provider === "claude") {
      child = spawnFn("claude", [
        "-p",
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "json",
        "--allowedTools",
        "Read,Write,Edit,MultiEdit,LS,Grep,Glob",
        "--add-dir",
        workspaceRoot,
      ], { cwd: workspaceRoot, env, stdio: ["pipe", "pipe", "pipe"] });
    } else {
      child = spawnFn(command, { cwd: workspaceRoot, env, shell: true, stdio: ["pipe", "pipe", "pipe"] });
    }

    const result = await collectChildResult(child, prompt);
    const fileOutput = outputFile && existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
    const output = fileOutput.trim() ? fileOutput : result.stdout;
    if (result.exitCode !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || `agent exited with code ${result.exitCode}`;
      throw new Error(error.slice(0, 2000));
    }
    return { exitCode: result.exitCode, output, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function parseAgentResult(rawOutput) {
  const candidates = resultCandidates(rawOutput);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeResultPayload(parsed);
      if (normalized.comments.length) return normalized;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("no parseable result payload");
}

export function normalizeResultPayload(payload) {
  if (payload && typeof payload === "object" && typeof payload.result === "string") {
    return parseAgentResult(payload.result);
  }

  const comments = [];
  if (Array.isArray(payload?.comments)) {
    for (const item of payload.comments) {
      const result = normalizeSingleResult(item);
      if (result) comments.push(result);
    }
  }

  for (const [key, status] of Object.entries({
    resolved: "resolved",
    noOp: "no-op",
    noop: "no-op",
    blocked: "blocked",
    stale: "stale",
    ignored: "ignored",
    partial: "partial",
    needsFollowup: "needs_followup",
    needs_followup: "needs_followup",
  })) {
    if (!Array.isArray(payload?.[key])) continue;
    for (const item of payload[key]) {
      const result = normalizeSingleResult({ ...item, status: item.status || status });
      if (result) comments.push(result);
    }
  }

  return { comments };
}

export function describeAgentConfig(config) {
  const filter = describeAgentFilter(config.policy, config.trigger);
  const provider = config.provider === "custom" ? `custom command (${config.command})` : config.provider;
  const prompt = config.promptOverride ? "; custom prompt" : config.promptAppend ? "; extra instructions" : "";
  const owner = config.ownerName ? `; owner ${config.ownerName}` : "";
  return `${provider}; handles ${filter}; checks every ${config.intervalSeconds}s; max ${config.maxPasses} passes${owner}${prompt}; state ${config.statePath}`;
}

export function describeAgentSessionConfig(config) {
  const filter = describeAgentFilter(config.policy, config.trigger);
  const prompt = config.promptAppend ? "; extra instructions" : "";
  const owner = config.ownerName ? `; owner ${config.ownerName}` : "";
  return `active-agent inbox; handles ${filter}; max ${config.maxPasses} passes${owner}${prompt}; state ${config.statePath}`;
}

function formatAgentSessionClaim(result) {
  const ids = result.comments.map((comment) => comment.id).join(", ");
  const claim = result.claim ? `; claim ${result.claim.id}` : "";
  return `\nAgent inbox: claimed ${ids}${claim}\n\n${result.prompt}`;
}

export function defaultAgentBehaviorPrompt() {
  return `# Tunelito Local Agent Worker

You are being invoked by Tunelito to review local HTML or Markdown feedback and edit the matching source files when appropriate.

## Core Behavior

- Treat each listed comment as reviewer feedback from a trusted local review session.
- Tunelito prefilters comments by the configured local agent policy before invoking you.
- If the workspace lists an Owner, comments may include authorRole "owner" or "visitor"; visitor comments can also include ownerApproval metadata when the owner explicitly approved them for agent work. Use that role and approval metadata when host instructions ask you to prefer, ignore, or wait for owner feedback.
- Use judgment: some comments ask for edits, some are questions, some are observations, and some may already be satisfied.
- Make focused HTML, Markdown, CSS, or asset edits when the requested change is clear and safe.
- Return status "ignored" when a comment does not ask for a file change.
- Return status "no-op" when the requested change is already satisfied.
- Return status "stale" or "blocked" when the quoted text or target page cannot be found, or when the request is too ambiguous to complete safely.
- Address only the comment IDs listed below.
- Use each comment's pagePath to find the matching source file. For pagePath "/", inspect the single served target, index.html, or index.md as appropriate.
- Page-scope comments apply to the listed pagePath. They may be anchored inline selections or unanchored page notes.
- Site-scope comments apply to the whole served folder or site. Inspect related HTML or Markdown files and update every clearly relevant page when the request is actionable.
- Comments may have no selected quote. Use the body, scope, and pagePath to decide the target; mark broad or unclear requests "blocked" or "partial" instead of guessing.
- If an actionable comment is too large for one safe pass, complete one coherent slice now and return status "needs_followup" with completedTasks and remainingTasks.
- Continuation can apply to any comment scope: inline selected-text comments, page notes, and site notes.
- When a comment includes continuation context, continue from the listed remainingTasks and do not redo completedTasks.
- Return "resolved" only when the comment is fully addressed. Return "partial" when some work was done but you are stopping because the remaining work is ambiguous, unsafe, or beyond the pass limit.
- Do not edit the comments inbox.
- Do not edit the resolution ledger.
- Keep changes focused on the requested local files.
- Return only JSON as your final response. Do not wrap it in Markdown.`;
}

function normalizeSingleResult(item) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const status = normalizeStatus(item.status);
  if (!RESULT_STATUSES.has(status)) return null;
  return {
    id: String(item.id),
    status,
    summary: String(item.summary || item.message || ""),
    filesChanged: normalizeStringList(item.filesChanged),
    completedTasks: normalizeStringList(item.completedTasks),
    remainingTasks: normalizeStringList(item.remainingTasks),
  };
}

function formatAgentWorkStatus(comment, existing, checkedAt) {
  const status = existing?.status || "pending";
  const details = workStatusDetails(status);
  const done = [];
  const todo = [];

  for (const task of normalizeStringList(existing?.completedTasks)) done.push(task);

  if (isTerminalStatus(status)) {
    if (!done.length) done.push(existing?.summary || summarizeCommentRequest(comment));
  } else if (status === "needs_followup") {
    if (!done.length && existing?.summary) done.push(existing.summary);
    const remaining = normalizeStringList(existing?.remainingTasks);
    todo.push(...(remaining.length ? remaining : [summarizeCommentRequest(comment)]));
  } else {
    const active = status === "claimed" || status === "in_progress";
    const prefix = active ? `${details.label}: ` : "";
    todo.push(`${prefix}${summarizeCommentRequest(comment)}`);
  }

  return {
    id: comment.id,
    status,
    label: details.label,
    tone: details.tone,
    done,
    todo,
    summary: existing?.summary || "",
    filesChanged: normalizeStringList(existing?.filesChanged),
    updatedAt: existing?.updatedAt || "",
    completedAt: existing?.completedAt || null,
    claim: existing?.claim ? {
      id: existing.claim.id || "",
      owner: existing.claim.owner || "",
      expiresAt: existing.claim.expiresAt || "",
      active: hasActiveClaim(existing, checkedAt),
    } : null,
  };
}

function summarizeCommentRequest(comment) {
  const body = preview(comment?.body || comment?.quote || "");
  return body || `Address ${comment?.scope || "page"} comment`;
}

function workStatusDetails(status) {
  if (status === "claimed" || status === "in_progress") return { label: "Being worked on", tone: "active" };
  if (status === "needs_followup") return { label: "Needs follow-up", tone: "warning" };
  if (status === "resolved") return { label: "Integrated", tone: "done" };
  if (status === "no-op") return { label: "Already covered", tone: "done" };
  if (status === "ignored") return { label: "Not actionable", tone: "muted" };
  if (status === "blocked") return { label: "Blocked", tone: "danger" };
  if (status === "stale") return { label: "Stale", tone: "danger" };
  if (status === "partial") return { label: "Partially done", tone: "warning" };
  if (status === "changed_needs_review") return { label: "Changed, needs review", tone: "warning" };
  return { label: "Queued", tone: "pending" };
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "noop" || value === "no_op") return "no-op";
  if (value === "success" || value === "complete" || value === "completed") return "resolved";
  if (value === "needs-followup" || value === "needs-follow-up" || value === "needs followup" || value === "needs follow-up" || value === "followup" || value === "follow-up" || value === "continue") return "needs_followup";
  return value;
}

function describeAgentFilter(policy = DEFAULT_AGENT_POLICY, trigger = DEFAULT_AGENT_TRIGGER) {
  const normalizedPolicy = normalizeAgentPolicy(policy);
  if (normalizedPolicy === "owner") return "owner-authored or owner-approved comments";
  if (normalizedPolicy === "mention") return `comments containing "${trigger}"`;
  if (normalizedPolicy === "owner-or-mention") return `owner-authored or owner-approved comments, or comments containing "${trigger}"`;
  return isAllTrigger(trigger) ? "all comments" : `comments containing "${trigger}"`;
}

function requiresMentionTrigger(policy) {
  return policy === "mention" || policy === "owner-or-mention";
}

function isAllTrigger(trigger) {
  return !trigger || String(trigger).trim().toLowerCase() === "all";
}

function isOwnerComment(comment) {
  return String(comment?.authorRole || "").trim().toLowerCase() === "owner";
}

function isOwnerApprovedComment(comment) {
  return Boolean(comment?.ownerApproval?.approvedAt && comment.ownerApproval.fingerprint === fingerprintComment(comment));
}

function resultCandidates(output) {
  const raw = String(output || "").trim();
  const candidates = [];
  if (raw) candidates.push(raw);
  const fences = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const match of fences.reverse()) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  return candidates;
}

function markResult(state, comment, fingerprint, result, { now, maxPasses }) {
  const previous = state.comments[comment.id] || {};
  const passes = Number(previous.passes || 0) + 1;
  let status = result.status;
  let lastError = null;

  const wasContinuation = previous.status === "needs_followup" || previous.previousStatus === "needs_followup";
  if (status === "needs_followup" && wasContinuation && !hasContinuationProgress(previous, result)) {
    status = "partial";
    lastError = "Agent requested follow-up without observable progress.";
  }
  if (status === "needs_followup" && !result.remainingTasks.length) {
    status = "partial";
    lastError = "Agent requested follow-up without remaining tasks.";
  }
  if (status === "needs_followup" && passes >= maxPasses) {
    status = "partial";
    lastError = `Pass limit reached (${maxPasses}).`;
  }

  const completedAt = status === "needs_followup" ? null : now;
  const filesChanged = mergeStringLists(previous.filesChanged, result.filesChanged);
  const completedTasks = mergeStringLists(previous.completedTasks, result.completedTasks);
  state.comments[comment.id] = {
    ...previous,
    id: comment.id,
    fingerprint,
    status,
    summary: result.summary,
    filesChanged,
    completedTasks,
    remainingTasks: result.remainingTasks,
    passes,
    lastPassAt: now,
    completedAt,
    previousStatus: undefined,
    claim: undefined,
    updatedAt: now,
    lastError,
  };
}

function markRetryOrBlocked(state, comment, fingerprint, { now, maxAttempts, error }) {
  const failures = failureAttempts(state.comments[comment.id]) + 1;
  if (failures >= maxAttempts) {
    markBlocked(state, comment, fingerprint, { now, error, failures });
    return;
  }
  state.comments[comment.id] = {
    ...state.comments[comment.id],
    id: comment.id,
    fingerprint,
    status: "pending",
    claim: undefined,
    lastError: error,
    failures,
    updatedAt: now,
  };
}

function markBlocked(state, comment, fingerprint, { now, error, failures }) {
  state.comments[comment.id] = {
    ...state.comments[comment.id],
    id: comment.id,
    fingerprint,
    status: "blocked",
    claim: undefined,
    lastError: error,
    failures: typeof failures === "number" ? failures : state.comments[comment.id]?.failures,
    completedAt: now,
    updatedAt: now,
  };
}

function markPassLimitPartial(state, comment, fingerprint, { now, maxPasses }) {
  state.comments[comment.id] = {
    ...state.comments[comment.id],
    id: comment.id,
    fingerprint,
    status: "partial",
    claim: undefined,
    lastError: `Pass limit reached (${maxPasses}).`,
    completedAt: now,
    updatedAt: now,
  };
}

function appendAgentLog(logPath, entry) {
  mkdirSync(dirname(logPath), { recursive: true });
  const lines = [
    `## ${entry.runId} at ${entry.finishedAt || entry.startedAt}`,
    "",
    `provider: ${entry.provider}`,
    `reason: ${entry.reason}`,
    `comments: ${entry.comments.map((comment) => comment.id).join(", ")}`,
  ];
  if (entry.results?.length) {
    lines.push("", "results:");
    for (const result of entry.results) {
      lines.push(`- ${result.id}: ${result.status}${result.summary ? ` - ${result.summary}` : ""}`);
    }
  }
  if (entry.error) {
    lines.push("", `error: ${entry.error}`);
  }
  lines.push("");
  appendFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}

function collectChildResult(child, prompt) {
  return new Promise((resolveResult, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolveResult({ exitCode, stdout, stderr });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
}

function appendLimited(existing, chunk) {
  const combined = existing + String(chunk);
  return combined.length > CAPTURE_LIMIT ? combined.slice(combined.length - CAPTURE_LIMIT) : combined;
}

function wrapSpawn(spawnFn, onChild) {
  return (...args) => {
    const child = spawnFn(...args);
    onChild(child);
    return child;
  };
}

function formatCommentForPrompt(comment, existing, { maxPasses } = {}) {
  const formatted = {
    id: comment.id,
    author: comment.author,
    authorRole: comment.authorRole === "owner" ? "owner" : "visitor",
    scope: comment.scope || "page",
    pagePath: comment.pagePath || "/",
    quote: comment.quote,
    body: comment.body,
    path: comment.path || "",
    textStart: comment.textStart,
    textEnd: comment.textEnd,
    created: comment.created,
  };
  if (comment.ownerApproval?.approvedAt) {
    formatted.ownerApproval = {
      approvedBy: comment.ownerApproval.approvedBy || "Owner",
      approvedAt: comment.ownerApproval.approvedAt,
    };
  }
  const hasContinuationContext = existing?.status === "needs_followup" || existing?.previousStatus === "needs_followup";
  if (hasContinuationContext) {
    formatted.continuation = {
      status: "needs_followup",
      retryStatus: existing.status || "",
      passesCompleted: Number(existing.passes || 0),
      maxPasses,
      previousSummary: existing.summary || "",
      filesChanged: normalizeStringList(existing.filesChanged),
      completedTasks: normalizeStringList(existing.completedTasks),
      remainingTasks: normalizeStringList(existing.remainingTasks),
      lastError: existing.lastError || "",
      lastPassAt: existing.lastPassAt || existing.updatedAt || "",
    };
  }
  return formatted;
}

function emptyAgentState() {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    comments: {},
  };
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || ""));
}

function hasActiveClaim(existing, now) {
  if (!existing?.claim?.expiresAt) return false;
  const expiresAt = new Date(existing.claim.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > now.getTime();
}

function hasActiveClaimForOwner({ commentsPath, statePath, claimOwner, now }) {
  if (!existsSync(statePath)) return false;
  const state = loadAgentState(statePath);
  const visibleCommentIds = existsSync(commentsPath)
    ? new Set(loadCommentsFromMarkdown(commentsPath).map((comment) => comment.id).filter(Boolean))
    : null;
  return Object.entries(state.comments || {}).some(([id, existing]) => {
    if (visibleCommentIds && !visibleCommentIds.has(id)) return false;
    return existing?.claim?.owner === claimOwner && hasActiveClaim(existing, now);
  });
}

function failureAttempts(existing) {
  if (!existing) return 0;
  if (Number.isInteger(Number(existing.failures))) return Number(existing.failures);
  if (existing.lastError && (existing.status === "pending" || existing.status === "in_progress")) return Number(existing.attempts || 0);
  return 0;
}

function hasContinuationProgress(previous, result) {
  if (result.filesChanged.length) return true;
  if (hasNewStringItem(previous.completedTasks, result.completedTasks)) return true;
  if (!sameStringList(previous.remainingTasks, result.remainingTasks)) return true;
  return false;
}

function hasNewStringItem(previousValues, nextValues) {
  const previous = new Set(normalizeStringList(previousValues));
  return normalizeStringList(nextValues).some((value) => !previous.has(value));
}

function sameStringList(left, right) {
  const leftValues = normalizeStringList(left);
  const rightValues = normalizeStringList(right);
  if (leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
}

function mergeStringLists(left, right) {
  return Array.from(new Set([...normalizeStringList(left), ...normalizeStringList(right)]));
}

function preview(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 240);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizePromptText(value) {
  return String(value || "").trim();
}

function cleanOwnerName(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, 80);
}

function cleanClaimOwner(value) {
  return String(value || "agent-session").replace(/\u0000/g, "").trim().slice(0, 80) || "agent-session";
}
