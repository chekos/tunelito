import { spawn } from "node:child_process";
import { TUNELITO_RESPONSE_HEADER } from "./inject.js";

const TRY_CLOUDFLARE_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com(?:[/?#][^\s"'<>]*)?/g;
const QUICK_TUNNEL_READY = /your quick tunnel has been created/i;
const TUNNEL_CONNECTION_READY = /registered tunnel connection/i;
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const DEFAULT_CLOUDFLARED_PACKAGE = "cloudflared@latest";
const DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;
const DEFAULT_VERIFICATION_RETRY_MS = 250;

export function startCloudflareTunnel({
  localUrl,
  accessKey = "",
  onUrl,
  onError,
  onFallback,
  env = process.env,
  spawnFn = spawn,
  verifyFn = verifyTunelitoTunnel,
  fetchFn = globalThis.fetch,
  discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  verificationTimeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
}) {
  let child = null;
  let emittedUrl = false;
  let startupError = null;
  let triedNpx = false;
  let stopped = false;
  let quickTunnelReady = false;
  let tunnelConnectionReady = false;
  let verifyingUrl = false;
  let childExited = false;
  let discoveryTimer = null;
  const pendingUrls = [];
  const seenUrls = new Set();
  let launchSequence = 0;
  const fallbackPackage = cloudflaredFallbackPackage(env);

  function inspectLine(rawLine) {
    const line = stripAnsi(rawLine);
    if (QUICK_TUNNEL_READY.test(line)) quickTunnelReady = true;
    if (TUNNEL_CONNECTION_READY.test(line)) tunnelConnectionReady = true;

    for (const candidate of extractTryCloudflareUrls(line)) {
      if (!isQuickTunnelCandidate(candidate) || seenUrls.has(candidate)) continue;
      seenUrls.add(candidate);
      pendingUrls.push(candidate);
    }
    verifyNextCandidate();
  }

  function verifyNextCandidate() {
    if (!quickTunnelReady || !tunnelConnectionReady || emittedUrl || verifyingUrl || !pendingUrls.length || startupError || stopped) return;
    clearDiscoveryTimer();
    const candidate = pendingUrls.shift();
    verifyingUrl = true;
    Promise.resolve(verifyFn({
      url: candidate,
      accessKey,
      fetchFn,
      timeoutMs: verificationTimeoutMs,
    })).then(() => {
      if (stopped || childExited) {
        throw new Error("cloudflared exited before the verified tunnel URL could be published");
      }
      emittedUrl = true;
      clearDiscoveryTimer();
      onUrl?.(candidate);
    }).catch((error) => {
      verifyingUrl = false;
      if (stopped) return;
      if (pendingUrls.length) {
        verifyNextCandidate();
        return;
      }
      reportStartupError(error);
    });
  }

  function launch(command, args) {
    const sequence = launchSequence + 1;
    launchSequence = sequence;
    childExited = false;
    quickTunnelReady = false;
    tunnelConnectionReady = false;
    scheduleDiscoveryTimeout();
    const launchedChild = spawnFn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child = launchedChild;
    const flushStreams = [
      inspectStream(launchedChild.stdout, inspectLine),
      inspectStream(launchedChild.stderr, inspectLine),
    ];
    launchedChild.on("error", (error) => {
      if (sequence !== launchSequence) return;
      if (error.code === "ENOENT" && !triedNpx) {
        triedNpx = true;
        onFallback?.(fallbackPackage);
        clearDiscoveryTimer();
        launch("npx", cloudflaredNpxArgs({ localUrl, packageName: fallbackPackage }));
        return;
      }
      reportStartupError(error);
    });
    launchedChild.on("exit", (code, signal) => {
      if (sequence !== launchSequence) return;
      childExited = true;
      for (const flush of flushStreams) flush();
      if (!stopped && emittedUrl) {
        onError?.(new Error(`${command} exited after publishing the verified tunnel URL (${signal || code})`));
      } else if (!stopped && !startupError && !verifyingUrl) {
        reportStartupError(new Error(`${command} exited before publishing a URL (${signal || code})`));
      }
    });
  }

  function scheduleDiscoveryTimeout() {
    clearDiscoveryTimer();
    discoveryTimer = setTimeout(() => {
      if (emittedUrl || verifyingUrl || startupError || stopped) return;
      reportStartupError(new Error("cloudflared did not produce and register a Quick Tunnel before startup timed out"));
    }, Math.max(1, discoveryTimeoutMs));
  }

  function clearDiscoveryTimer() {
    if (!discoveryTimer) return;
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
  }

  function reportStartupError(error) {
    if (startupError || stopped) return;
    startupError = error;
    clearDiscoveryTimer();
    if (child && !child.killed) child.kill("SIGTERM");
    onError?.(error);
  }

  launch("cloudflared", ["tunnel", "--url", localUrl]);

  return {
    get process() {
      return child;
    },
    stop() {
      stopped = true;
      clearDiscoveryTimer();
      if (child && !child.killed) child.kill("SIGTERM");
    },
  };
}

export async function verifyTunelitoTunnel({
  url,
  accessKey = "",
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
  retryMs = DEFAULT_VERIFICATION_RETRY_MS,
  sleepFn = sleep,
}) {
  if (typeof fetchFn !== "function") {
    throw new Error("Tunnel verification requires fetch support.");
  }
  const candidate = new URL(url);
  if (accessKey) candidate.searchParams.set("tunelito_key", accessKey);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let lastFailure = "";

  do {
    const remaining = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, 3_000));
    try {
      const response = await fetchFn(candidate, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status === 200 && response.headers.get(TUNELITO_RESPONSE_HEADER) === "1") {
        return;
      }
      lastFailure = `HTTP ${response.status} without the Tunelito marker`;
    } catch (error) {
      lastFailure = error.name === "AbortError" ? "request timed out" : error.message;
    } finally {
      clearTimeout(timer);
    }

    const waitMs = Math.min(Math.max(0, retryMs), Math.max(0, deadline - Date.now()));
    if (waitMs > 0) await sleepFn(waitMs);
  } while (Date.now() < deadline);

  throw new Error(`Quick Tunnel ${new URL(url).hostname} did not route to Tunelito before verification timed out${lastFailure ? ` (${lastFailure})` : ""}.`);
}

export function cloudflaredFallbackPackage(env = process.env) {
  return String(env.TUNELITO_CLOUDFLARED_PACKAGE || "").trim() || DEFAULT_CLOUDFLARED_PACKAGE;
}

export function cloudflaredNpxArgs({ localUrl, packageName = DEFAULT_CLOUDFLARED_PACKAGE }) {
  return ["--yes", packageName, "tunnel", "--url", localUrl];
}

function inspectStream(stream, inspectLine) {
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    inspectLine(buffer);
    buffer = "";
  };
  stream.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split(/\r\n|\n|\r/);
    buffer = lines.pop() || "";
    for (const line of lines) inspectLine(line);
  });
  stream.on("end", flush);
  return flush;
}

function extractTryCloudflareUrls(line) {
  return Array.from(String(line).matchAll(TRY_CLOUDFLARE_URL), (match) => match[0]);
}

function isQuickTunnelCandidate(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.endsWith(".trycloudflare.com")
      && url.hostname !== "api.trycloudflare.com"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function stripAnsi(value) {
  return String(value).replace(ANSI_ESCAPE, "");
}

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
