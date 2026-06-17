import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import { buildCommentsIndex } from "./comment-index.js";
import { defaultAgentStatePath, loadAgentState } from "./agent-worker.js";
import { cloudflaredFallbackPackage } from "./tunnel.js";

export const DOCTOR_FORMAT = "tunelito-doctor";
export const DOCTOR_VERSION = 1;

const TERMINAL_AGENT_STATUSES = new Set(["resolved", "no-op", "blocked", "stale", "ignored", "partial", "changed_needs_review"]);

export async function buildDoctorReport(options = {}, deps = {}) {
  const checks = [];
  const now = deps.now || (() => new Date());
  const commandExists = deps.commandExists || defaultCommandExists;
  const checkPort = deps.checkPort || checkPortAvailable;
  const cwd = resolve(options.cwd || process.cwd());

  addCheck(checks, {
    id: "runtime.package",
    severity: "info",
    status: "pass",
    message: `Tunelito ${packageVersion()} is available.`,
    details: { version: packageVersion() },
  });
  addNodeVersionCheck(checks, process.version);
  addCheck(checks, {
    id: "runtime.cwd",
    severity: "info",
    status: "pass",
    message: `Current working directory is ${cwd}.`,
    details: { cwd },
  });

  const targetPath = options.targetPath ? resolve(options.targetPath) : null;
  const commentsPath = options.commentsPath ? resolve(options.commentsPath) : null;
  if (targetPath) addTargetChecks(checks, targetPath);
  else if (commentsPath) {
    addCheck(checks, {
      id: "target.missing",
      severity: "warning",
      status: "warn",
      message: "--out was provided without a target; only the comments path can be inspected.",
    });
  } else {
    addCheck(checks, {
      id: "target.not-provided",
      severity: "info",
      status: "pass",
      message: "No target path provided; runtime-only diagnostics were run.",
    });
  }

  if (targetPath || commentsPath) {
    addCommentsChecks(checks, { targetPath, commentsPath });
  }

  const statePath = options.agentStatePath
    ? resolve(options.agentStatePath)
    : targetPath && existsSync(targetPath)
      ? defaultAgentStatePath(targetPath)
      : null;
  if (statePath) addAgentStateChecks(checks, statePath, now());

  addHostSafetyChecks(checks, options);
  await addPortCheck(checks, {
    host: options.host || "127.0.0.1",
    port: options.port ?? 4317,
    checkPort,
  });
  addTunnelChecks(checks, { options, commandExists });

  return {
    format: DOCTOR_FORMAT,
    version: DOCTOR_VERSION,
    ok: !checks.some((check) => check.severity === "error"),
    summary: summarizeChecks(checks),
    checks,
  };
}

function packageVersion() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return pkg.version;
}

function addNodeVersionCheck(checks, version) {
  const major = Number(String(version).replace(/^v/, "").split(".")[0]);
  const pass = Number.isInteger(major) && major >= 22;
  addCheck(checks, {
    id: "runtime.node-version",
    severity: pass ? "info" : "error",
    status: pass ? "pass" : "fail",
    message: pass ? `Node ${version} satisfies >=22.` : `Node ${version} does not satisfy Tunelito's >=22 requirement.`,
    details: { version, required: ">=22" },
  });
}

function addTargetChecks(checks, targetPath) {
  if (!existsSync(targetPath)) {
    addCheck(checks, {
      id: "target.exists",
      severity: "error",
      status: "fail",
      message: `Target path does not exist: ${targetPath}`,
    });
    return;
  }

  const stat = statSync(targetPath);
  if (stat.isFile()) {
    const html = /\.html?$/i.test(targetPath);
    addCheck(checks, {
      id: "target.file",
      severity: html ? "info" : "error",
      status: html ? "pass" : "fail",
      message: html ? `Target file is HTML: ${targetPath}` : `Target file is not .html or .htm: ${targetPath}`,
      details: { type: "file" },
    });
    return;
  }

  if (stat.isDirectory()) {
    const htmlFiles = readdirSync(targetPath).filter((entry) => /\.html?$/i.test(entry));
    addCheck(checks, {
      id: "target.folder",
      severity: "info",
      status: "pass",
      message: `Target folder exists: ${targetPath}`,
      details: { type: "folder", htmlFiles: htmlFiles.map((entry) => basename(entry)) },
    });
    if (!htmlFiles.length) {
      addCheck(checks, {
        id: "target.folder-html",
        severity: "warning",
        status: "warn",
        message: "Target folder contains no top-level HTML files; Tunelito can serve a generated directory index, but reviewers may have nothing to annotate.",
      });
    }
    return;
  }

  addCheck(checks, {
    id: "target.type",
    severity: "error",
    status: "fail",
    message: `Target path is not a file or folder: ${targetPath}`,
  });
}

function addCommentsChecks(checks, { targetPath, commentsPath }) {
  const index = buildCommentsIndex({ targetPath, commentsPath });
  addCheck(checks, {
    id: "comments.path",
    severity: "info",
    status: "pass",
    message: `Comments path is ${index.commentsPath || "(not available)"}.`,
    details: { targetPath: index.targetPath, commentsPath: index.commentsPath },
  });
  addCheck(checks, {
    id: "comments.index",
    severity: index.ok ? "info" : "error",
    status: index.ok ? "pass" : "fail",
    message: index.ok
      ? `Comments index is readable with ${index.summary.total} comment(s).`
      : "Comments index has error-level diagnostics.",
    details: { summary: index.summary },
  });
  for (const item of index.diagnostics) {
    addCheck(checks, {
      id: item.code,
      severity: item.severity,
      status: item.severity === "error" ? "fail" : item.severity === "warning" ? "warn" : "pass",
      message: item.message,
      details: { line: item.line, offset: item.offset },
    });
  }
}

function addAgentStateChecks(checks, statePath, currentTime) {
  if (!existsSync(statePath)) {
    addCheck(checks, {
      id: "agent-state.missing",
      severity: "info",
      status: "pass",
      message: `Agent state file does not exist yet: ${statePath}`,
      details: { statePath },
    });
    return;
  }

  try {
    const state = loadAgentState(statePath);
    const states = Object.values(state.comments || {});
    const activeClaims = states.filter((item) => item.claim?.expiresAt && Date.parse(item.claim.expiresAt) > currentTime.getTime()).length;
    const expiredClaims = states.filter((item) => item.claim?.expiresAt && Date.parse(item.claim.expiresAt) <= currentTime.getTime()).length;
    const terminal = states.filter((item) => TERMINAL_AGENT_STATUSES.has(item.status)).length;
    addCheck(checks, {
      id: "agent-state.parse",
      severity: "info",
      status: "pass",
      message: `Agent state file is parseable: ${statePath}`,
      details: {
        statePath,
        comments: states.length,
        terminal,
        nonTerminal: states.length - terminal,
        activeClaims,
        expiredClaims,
      },
    });
  } catch (error) {
    addCheck(checks, {
      id: "agent-state.invalid-json",
      severity: "error",
      status: "fail",
      message: `Agent state file could not be parsed: ${error.message}`,
      details: { statePath },
    });
  }
}

function addHostSafetyChecks(checks, options) {
  const host = options.host || "127.0.0.1";
  if (!isLoopbackHost(host)) {
    addCheck(checks, {
      id: "safety.non-loopback-host",
      severity: "warning",
      status: "warn",
      message: `Host ${host} is not loopback; use this only when the local network exposure is intentional.`,
    });
  }
  if (options.auth === false && options.tunnel !== false) {
    addCheck(checks, {
      id: "safety.no-auth-tunnel",
      severity: "warning",
      status: "warn",
      message: "--no-auth does not disable the tunnel; add --no-tunnel for local-only sessions.",
    });
  }
  if (options.live && (options.agent || options.agentSession || options.agentStatePath || options.agentPolicyProvided)) {
    addCheck(checks, {
      id: "safety.live-agent",
      severity: "error",
      status: "fail",
      message: "--live uses ephemeral comments and is incompatible with agent workflows that require a persistent inbox.",
    });
  }
  if (options.agent || options.agentSession || options.agentStatePath || options.agentPolicyProvided) {
    addCheck(checks, {
      id: "safety.agent-input",
      severity: "warning",
      status: "warn",
      message: "Reviewer comments can become local agent instructions; use trusted sessions, owner approval, or mention policies as appropriate.",
    });
  }
}

async function addPortCheck(checks, { host, port, checkPort }) {
  if (port === 0) {
    addCheck(checks, {
      id: "network.port",
      severity: "info",
      status: "pass",
      message: "Port 0 lets the operating system choose an available port.",
      details: { host, port },
    });
    return;
  }
  const result = await checkPort({ host, port });
  addCheck(checks, {
    id: "network.port",
    severity: result.available === false ? "error" : result.available === true ? "info" : "warning",
    status: result.available === false ? "fail" : result.available === true ? "pass" : "warn",
    message: result.available === true
      ? `Port ${port} appears available on ${host}.`
      : result.available === false
        ? `Port ${port} appears in use on ${host}: ${result.error || "listener detected"}`
        : `Port ${port} availability on ${host} could not be determined without binding a socket: ${result.error || "no non-binding checker available"}`,
    details: { host, port },
  });
}

function addTunnelChecks(checks, { options, commandExists }) {
  if (options.tunnel === false) {
    addCheck(checks, {
      id: "network.tunnel",
      severity: "info",
      status: "pass",
      message: "Tunnel startup is disabled by --no-tunnel.",
    });
    return;
  }
  const available = commandExists("cloudflared");
  addCheck(checks, {
    id: "network.cloudflared",
    severity: available ? "info" : "warning",
    status: available ? "pass" : "warn",
    message: available
      ? "cloudflared is available on PATH."
      : `cloudflared was not found on PATH; Tunelito would try npx ${cloudflaredFallbackPackage()} when starting a tunnel.`,
  });
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host).toLowerCase());
}

function addCheck(checks, check) {
  checks.push(check);
}

function summarizeChecks(checks) {
  return {
    errors: checks.filter((check) => check.severity === "error").length,
    warnings: checks.filter((check) => check.severity === "warning").length,
    info: checks.filter((check) => check.severity === "info").length,
  };
}

function defaultCommandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", timeout: 2000 });
  return result.status === 0;
}

function checkPortAvailable({ port }) {
  return new Promise((resolvePort) => {
    const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (result.error) {
      resolvePort({ available: null, error: result.error.message });
      return;
    }
    if (result.status === 0 && result.stdout.trim()) {
      resolvePort({ available: false, error: "listener detected" });
      return;
    }
    if (result.status === 1) {
      resolvePort({ available: true });
      return;
    }
    resolvePort({ available: null, error: result.stderr?.trim() || `lsof exited with status ${result.status}` });
  });
}
