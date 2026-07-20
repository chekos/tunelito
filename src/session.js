import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { agentWorkspaceRoot } from "./agent-worker.js";
import { SESSION_STATUS_ROUTE } from "./inject.js";

export const SESSION_FORMAT = "tunelito-session";
export const SESSION_VERSION = 1;

export function sessionPathForTarget(targetPath) {
  const resolvedTarget = resolve(targetPath);
  const workspaceRoot = existsSync(resolvedTarget)
    ? agentWorkspaceRoot(resolvedTarget)
    : [".html", ".htm", ".md"].includes(extname(resolvedTarget).toLowerCase())
      ? dirname(resolvedTarget)
      : resolvedTarget;
  return join(workspaceRoot, ".tunelito", "session.json");
}

export function writeSessionFile(sessionPath, session) {
  const resolvedPath = resolve(sessionPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, resolvedPath);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
  return resolvedPath;
}

export function updateSessionFile(sessionPath, patch) {
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  const next = typeof patch === "function" ? patch(session) : { ...session, ...patch };
  writeSessionFile(sessionPath, next);
  return next;
}

export function readSessionFile(targetPath) {
  const sessionPath = sessionPathForTarget(targetPath);
  if (!existsSync(sessionPath)) {
    throw new Error(`No Tunelito session metadata found for ${resolve(targetPath)}. Expected ${sessionPath}`);
  }
  let session;
  try {
    session = JSON.parse(readFileSync(sessionPath, "utf8"));
  } catch (error) {
    throw new Error(`Tunelito session metadata is corrupt at ${sessionPath}: ${error.message}`);
  }
  if (!session || session.format !== SESSION_FORMAT || session.schemaVersion !== SESSION_VERSION || !session.sessionId) {
    throw new Error(`Tunelito session metadata at ${sessionPath} has an unsupported format.`);
  }
  return { sessionPath, session };
}

export async function inspectSession(targetPath, {
  fetchFn = globalThis.fetch,
  isProcessAlive = defaultIsProcessAlive,
  now = () => new Date(),
  redact = false,
  commentsIndex = null,
} = {}) {
  const { sessionPath, session } = readSessionFile(targetPath);
  const pidAlive = isProcessAlive(session.pid);
  let probe = null;
  let probeError = "";
  const statusUrl = session.localUrl && session.lifecycle !== "stopped" ? sessionStatusUrl(session.localUrl) : "";

  if (statusUrl) {
    try {
      const response = await fetchFn(statusUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      probe = await response.json();
    } catch (error) {
      probeError = error.message;
    }
  }

  const identityMatches = Boolean(probe?.sessionId && probe.sessionId === session.sessionId);
  let status;
  if (session.lifecycle === "stopped") status = "stopped";
  else if (identityMatches && (session.tunnel?.state === "unavailable" || session.lifecycle === "degraded")) status = "degraded";
  else if (identityMatches) status = "running";
  else status = "stale";

  const localUrl = redactUrl(session.localUrl, redact);
  const publicUrl = redactUrl(session.publicUrl, redact);
  const reviewUrl = publicUrl || localUrl;
  const agentComments = commentsIndex?.agentStatus?.comments;
  const activeClaims = agentComments && typeof agentComments === "object"
    ? Object.values(agentComments).filter((item) => item?.claim?.active).length
    : null;

  return {
    format: "tunelito-session-status",
    schemaVersion: 1,
    status,
    sessionPath,
    session: {
      id: session.sessionId,
      tunelitoVersion: session.tunelitoVersion || "",
      targetPath: session.targetPath,
      sourceRoot: session.sourceRoot || session.workspaceRoot,
      directoryMode: Boolean(session.directoryMode),
      startedAt: session.startedAt || session.createdAt || "",
      lastActivityAt: probe?.lastActivityAt || session.lastActivityAt || "",
      stoppedAt: session.stoppedAt || "",
    },
    urls: {
      local: localUrl || null,
      public: publicUrl || null,
      review: reviewUrl || null,
      keyPresent: hasReviewKey(session.localUrl) || hasReviewKey(session.publicUrl),
      redacted: Boolean(redact),
    },
    comments: {
      path: session.commentsPath || null,
      persistence: session.persistence || (session.commentsPath ? "persistent" : "ephemeral"),
    },
    agent: {
      mode: session.agent?.mode || session.mode || "none",
      provider: session.agent?.provider || "",
      policy: session.agent?.policy || session.policy || "",
      trigger: session.agent?.trigger || session.trigger || "",
      statePath: session.agent?.statePath || session.statePath || null,
      activeClaims,
      unhandled: commentsIndex?.summary?.unhandled ?? null,
    },
    process: {
      pid: session.pid || null,
      pidAlive,
      listenerHealthy: identityMatches,
      identityMatches,
      viewerCount: identityMatches ? Number(probe.viewerCount || 0) : null,
      probeError: probeError || null,
    },
    tunnel: {
      enabled: Boolean(session.tunnel?.enabled),
      state: session.tunnel?.state || (session.publicUrl ? "connected" : "disabled"),
      error: session.tunnel?.error || null,
    },
    recovery: {
      reviewUrl: reviewUrl || null,
      statusCommand: `tunelito session status ${shellQuote(session.targetPath)}${redact ? " --redact" : ""}`,
      stopCommand: status === "running" || status === "degraded" ? `kill ${session.pid}` : null,
      suggestion: recoverySuggestion(status, { pidAlive, identityMatches, probeError }),
    },
    inspectedAt: now().toISOString(),
  };
}

export function formatSessionStatus(report) {
  const lines = [
    "Tunelito session",
    `Status:        ${report.status}`,
    `Session:       ${report.session.id} (Tunelito ${report.session.tunelitoVersion || "unknown"})`,
    `Target:        ${report.session.targetPath}`,
    `Source root:   ${report.session.sourceRoot}`,
    `Local:         ${report.urls.local || "(unavailable)"}`,
    `Public:        ${report.urls.public || "(not connected)"}`,
    `Access key:    ${report.urls.keyPresent ? (report.urls.redacted ? "present (redacted)" : "present") : "not used"}`,
    `Comments:      ${report.comments.persistence}${report.comments.path ? ` (${report.comments.path})` : " (memory only)"}`,
    `Agent:         ${formatAgent(report.agent)}`,
    `Process:       ${report.process.pid || "(unknown)"} (${report.process.listenerHealthy ? "listener verified" : report.process.pidAlive ? "PID alive, listener not verified" : "not running"})`,
    `Tunnel:        ${report.tunnel.enabled ? report.tunnel.state : "disabled"}`,
    `Viewers:       ${report.process.viewerCount ?? "(unavailable)"}`,
    `Started:       ${report.session.startedAt || "(unknown)"}`,
    `Last activity: ${report.session.lastActivityAt || "(unknown)"}`,
    `Metadata:      ${report.sessionPath}`,
    `Next:          ${report.recovery.suggestion}`,
  ];
  if (report.recovery.stopCommand) lines.push(`Stop:          ${report.recovery.stopCommand}`);
  return `${lines.join("\n")}\n`;
}

function formatAgent(agent) {
  if (!agent.mode || agent.mode === "none") return "none";
  const details = [agent.mode, agent.provider, agent.policy && `policy=${agent.policy}`, agent.trigger && `trigger=${agent.trigger}`].filter(Boolean);
  if (agent.activeClaims != null) details.push(`active claims=${agent.activeClaims}`);
  if (agent.unhandled != null) details.push(`unhandled=${agent.unhandled}`);
  return details.join(", ");
}

function recoverySuggestion(status, { pidAlive, identityMatches, probeError }) {
  if (status === "running") return "Open the review URL above or stop the session from its original shell.";
  if (status === "degraded") return "The local server is healthy, but the tunnel is unavailable; use Local or restart to reconnect the tunnel.";
  if (status === "stopped") return "Start a new Tunelito session for this target.";
  if (pidAlive && !identityMatches) return "The recorded PID is alive but does not own this listener; start a new session and replace stale metadata.";
  return `Start a new Tunelito session for this target${probeError ? `; the saved listener could not be verified (${probeError})` : ""}.`;
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasReviewKey(value) {
  if (!value) return false;
  try {
    return new URL(value).searchParams.has("tunelito_key");
  } catch {
    return false;
  }
}

function sessionStatusUrl(reviewUrl) {
  const source = new URL(reviewUrl);
  const status = new URL(SESSION_STATUS_ROUTE, source);
  const key = source.searchParams.get("tunelito_key");
  if (key) status.searchParams.set("tunelito_key", key);
  return status.toString();
}

export function redactUrl(value, redact) {
  if (!value || !redact) return value || "";
  try {
    const url = new URL(value);
    if (url.searchParams.has("tunelito_key")) url.searchParams.set("tunelito_key", "REDACTED");
    return url.toString();
  } catch {
    return value;
  }
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
