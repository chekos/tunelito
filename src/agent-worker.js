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
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadCommentsFromMarkdown } from "./comments.js";

export const DEFAULT_AGENT_INTERVAL_SECONDS = 120;
export const DEFAULT_AGENT_TRIGGER = "@agent";
export const DEFAULT_AGENT_MAX_ATTEMPTS = 2;

const STATE_VERSION = 1;
const TERMINAL_STATUSES = new Set(["resolved", "no-op", "blocked", "stale", "ignored", "partial", "changed_needs_review"]);
const RESULT_STATUSES = new Set(["resolved", "no-op", "blocked", "stale", "ignored", "partial"]);
const CAPTURE_LIMIT = 200_000;

export function createAgentWorker({
  provider,
  command,
  commentsPath,
  targetPath,
  statePath,
  intervalSeconds = DEFAULT_AGENT_INTERVAL_SECONDS,
  trigger = DEFAULT_AGENT_TRIGGER,
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
  spawnFn = spawn,
  now = () => new Date(),
  log = console.log,
} = {}) {
  const config = normalizeAgentConfig({ provider, command, commentsPath, targetPath, statePath, intervalSeconds, trigger, maxAttempts });
  let timer = null;
  let running = false;
  let stopped = false;
  let currentChild = null;

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

  return {
    ...config,
    description: describeAgentConfig(config),
    start() {
      schedule(0);
    },
    wake(reason = "comment") {
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
    },
    async runOnce(reason) {
      return runOnce(reason);
    },
    async stop() {
      stopped = true;
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
  maxAttempts,
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
  const prepared = prepareAgentQueue(comments, state, { trigger, maxAttempts, now });
  if (prepared.changed) saveAgentState(statePath, state, now);
  if (!prepared.pending.length) return { processed: 0, reason: "no-pending-comments" };

  const runId = `run_${now().getTime().toString(36)}`;
  const startedAt = now().toISOString();
  for (const item of prepared.pending) {
    const attempts = Number(state.comments[item.comment.id]?.attempts || 0) + 1;
    state.comments[item.comment.id] = {
      ...state.comments[item.comment.id],
      id: item.comment.id,
      fingerprint: item.fingerprint,
      status: "in_progress",
      attempts,
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
    maxAttempts,
  });

  let commandResult;
  try {
    commandResult = await runAgentCommand({
      provider,
      command,
      workspaceRoot,
      commentsPath,
      statePath,
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
    markResult(state, item.comment, item.fingerprint, result, finishedAt);
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
  maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS,
} = {}) {
  const normalizedProvider = command && !provider ? "custom" : String(provider || "").trim().toLowerCase();
  if (!normalizedProvider) throw new Error("--agent requires a provider such as codex or claude");
  if (!["codex", "claude", "custom"].includes(normalizedProvider)) {
    throw new Error(`Unsupported --agent provider: ${provider}. Use codex, claude, or --agent-command for custom CLIs.`);
  }
  if (command && normalizedProvider !== "custom") throw new Error("--agent-command can only be used with --agent custom");
  if (normalizedProvider === "custom" && !command) throw new Error("--agent custom requires --agent-command");
  if (!commentsPath) throw new Error("--agent requires persistent comments; remove --live");
  if (!targetPath) throw new Error("--agent requires a target HTML file or folder");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) throw new Error("--agent-interval must be a positive number of seconds");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("--agent-max-attempts must be a positive integer");

  const workspaceRoot = agentWorkspaceRoot(targetPath);
  const resolvedStatePath = resolve(statePath || defaultAgentStatePath(targetPath));
  return {
    provider: normalizedProvider,
    command: command || "",
    commentsPath: resolve(commentsPath),
    targetPath: resolve(targetPath),
    workspaceRoot,
    statePath: resolvedStatePath,
    logPath: defaultAgentLogPath(resolvedStatePath),
    intervalSeconds,
    trigger: trigger || DEFAULT_AGENT_TRIGGER,
    maxAttempts,
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

export function prepareAgentQueue(comments, state, { trigger = DEFAULT_AGENT_TRIGGER, maxAttempts = DEFAULT_AGENT_MAX_ATTEMPTS, now = () => new Date() } = {}) {
  const pending = [];
  let changed = false;
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
          changedAt: now().toISOString(),
          updatedAt: now().toISOString(),
        };
        changed = true;
        continue;
      }
    }

    if (isTerminalStatus(existing?.status)) continue;
    if (Number(existing?.attempts || 0) >= maxAttempts) {
      markBlocked(state, comment, fingerprint, {
        now: now().toISOString(),
        error: `Attempt limit reached (${maxAttempts}).`,
      });
      changed = true;
      continue;
    }
    if (!commentMatchesTrigger(comment, trigger)) continue;
    pending.push({ comment, fingerprint });
  }
  return { pending, changed };
}

export function fingerprintComment(comment) {
  const payload = {
    pagePath: comment.pagePath || "",
    quote: comment.quote || "",
    body: comment.body || "",
    created: comment.created || "",
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function commentMatchesTrigger(comment, trigger = DEFAULT_AGENT_TRIGGER) {
  if (!trigger || trigger === "all") return true;
  const text = `${comment.body || ""}\n${comment.quote || ""}`;
  return text.toLowerCase().includes(String(trigger).toLowerCase());
}

export function buildAgentPrompt({ comments, commentsPath, workspaceRoot, statePath, trigger, maxAttempts }) {
  return `# Tunelito Local Agent Worker

You are being invoked by Tunelito to address reviewer comments on local HTML files.

## Workspace

- HTML root: ${workspaceRoot}
- Comments inbox: ${commentsPath}
- Resolution ledger: ${statePath}
- Trigger: ${trigger}
- Max attempts per comment: ${maxAttempts}

## Rules

- Address only the comment IDs listed below.
- Use each comment's pagePath to find the matching HTML file. For pagePath "/", inspect index.html if it exists.
- Do not edit the comments inbox.
- Do not edit the resolution ledger.
- Before changing files, check whether the requested change is already satisfied.
- If already satisfied, return status "no-op".
- If the quoted text or target page cannot be found, return status "stale" or "blocked" instead of guessing.
- Keep changes focused on the requested HTML/CSS/asset edits.
- Return only JSON as your final response. Do not wrap it in Markdown.

## Required Final JSON Shape

{
  "comments": [
    {
      "id": "comment id",
      "status": "resolved | no-op | blocked | stale | ignored | partial",
      "summary": "short description",
      "filesChanged": ["relative/path.html"]
    }
  ]
}

## Comments To Address

${JSON.stringify(comments.map(formatCommentForPrompt), null, 2)}
`;
}

export async function runAgentCommand({ provider, command, workspaceRoot, commentsPath, statePath, prompt, spawnFn = spawn }) {
  const env = {
    ...process.env,
    TUNELITO_AGENT: provider,
    TUNELITO_AGENT_COMMENTS: commentsPath,
    TUNELITO_AGENT_STATE: statePath,
    TUNELITO_AGENT_ROOT: workspaceRoot,
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
  const trigger = config.trigger === "all" ? "all comments" : `comments containing "${config.trigger}"`;
  const provider = config.provider === "custom" ? `custom command (${config.command})` : config.provider;
  return `${provider}; checks ${trigger} every ${config.intervalSeconds}s; state ${config.statePath}`;
}

function normalizeSingleResult(item) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const status = normalizeStatus(item.status);
  if (!RESULT_STATUSES.has(status)) return null;
  return {
    id: String(item.id),
    status,
    summary: String(item.summary || item.message || ""),
    filesChanged: Array.isArray(item.filesChanged) ? item.filesChanged.map(String) : [],
  };
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "noop" || value === "no_op") return "no-op";
  if (value === "success" || value === "complete" || value === "completed") return "resolved";
  return value;
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

function markResult(state, comment, fingerprint, result, now) {
  state.comments[comment.id] = {
    ...state.comments[comment.id],
    id: comment.id,
    fingerprint,
    status: result.status,
    summary: result.summary,
    filesChanged: result.filesChanged,
    completedAt: now,
    updatedAt: now,
    lastError: null,
  };
}

function markRetryOrBlocked(state, comment, fingerprint, { now, maxAttempts, error }) {
  const attempts = Number(state.comments[comment.id]?.attempts || 0);
  if (attempts >= maxAttempts) {
    markBlocked(state, comment, fingerprint, { now, error });
    return;
  }
  state.comments[comment.id] = {
    ...state.comments[comment.id],
    id: comment.id,
    fingerprint,
    status: "pending",
    lastError: error,
    updatedAt: now,
  };
}

function markBlocked(state, comment, fingerprint, { now, error }) {
  state.comments[comment.id] = {
    ...state.comments[comment.id],
    id: comment.id,
    fingerprint,
    status: "blocked",
    lastError: error,
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

function formatCommentForPrompt(comment) {
  return {
    id: comment.id,
    author: comment.author,
    pagePath: comment.pagePath || "/",
    quote: comment.quote,
    body: comment.body,
    path: comment.path || "",
    textStart: comment.textStart,
    textEnd: comment.textEnd,
    created: comment.created,
  };
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

function preview(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 240);
}
