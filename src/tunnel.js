import { spawn } from "node:child_process";
import { Resolver } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { TUNELITO_RESPONSE_HEADER } from "./inject.js";

const TRY_CLOUDFLARE_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com(?:[/?#][^\s"'<>]*)?/g;
const QUICK_TUNNEL_READY = /your quick tunnel has been created/i;
const TUNNEL_CONNECTION_READY = /registered tunnel connection/i;
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const DEFAULT_CLOUDFLARED_PACKAGE = "cloudflared@latest";
const DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 120_000;
const DEFAULT_VERIFICATION_RETRY_MS = 250;
const DEFAULT_VERIFICATION_MAX_RETRY_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const PUBLIC_DNS_SERVERS = ["1.1.1.1", "1.0.0.1"];
// System resolver failures that mean "this hostname is not published here yet".
// macOS can cache the first negative answer for a brand-new Quick Tunnel
// hostname for over a minute, so these trigger a direct public-DNS lookup.
const DNS_NOT_READY_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME", "ENODATA"]);

export function startCloudflareTunnel({
  localUrl,
  accessKey = "",
  onUrl,
  onError,
  onFallback,
  onProgress,
  env = process.env,
  spawnFn = spawn,
  verifyFn = verifyTunelitoTunnel,
  requestFn,
  resolveFn,
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
  let verificationController = null;
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
    const controller = new AbortController();
    verificationController = controller;
    Promise.resolve(verifyFn({
      url: candidate,
      accessKey,
      timeoutMs: verificationTimeoutMs,
      signal: controller.signal,
      onProgress,
      ...(requestFn ? { requestFn } : {}),
      ...(resolveFn ? { resolveFn } : {}),
    })).then(() => {
      verificationController = null;
      verifyingUrl = false;
      if (stopped || childExited) {
        throw new Error("cloudflared exited before the verified tunnel URL could be published");
      }
      emittedUrl = true;
      clearDiscoveryTimer();
      onUrl?.(candidate);
    }).catch((error) => {
      verificationController = null;
      verifyingUrl = false;
      if (stopped) return;
      if (childExited) {
        reportStartupError(new Error(`cloudflared exited before the Quick Tunnel was verified (${error.message})`));
        return;
      }
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
      if (verifyingUrl) {
        // Stop waiting on a tunnel whose process is gone; the verification
        // rejection reports the exit.
        verificationController?.abort();
      } else if (!stopped && emittedUrl) {
        onError?.(new Error(`${command} exited after publishing the verified tunnel URL (${signal || code})`));
      } else if (!stopped && !startupError) {
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
      verificationController?.abort();
      if (child && !child.killed) child.kill("SIGTERM");
    },
  };
}

/**
 * Verify that a Quick Tunnel hostname routes to this Tunelito server.
 *
 * Fail-closed: resolves only after a keyed HEAD request returns HTTP 200 with
 * Tunelito's response marker. When the system resolver reports the new
 * hostname as missing (often a cached negative answer on macOS), each retry
 * also resolves it through public DNS and connects to that address while
 * keeping the original hostname for TLS SNI, certificate validation, and Host.
 */
export async function verifyTunelitoTunnel({
  url,
  accessKey = "",
  requestFn = headRequest,
  resolveFn = resolvePublicDns,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
  retryMs = DEFAULT_VERIFICATION_RETRY_MS,
  maxRetryMs = DEFAULT_VERIFICATION_MAX_RETRY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  signal,
  onProgress,
  sleepFn = sleep,
  now = Date.now,
}) {
  if (typeof requestFn !== "function") {
    throw new Error("Tunnel verification requires a request function.");
  }
  const candidate = new URL(url);
  if (accessKey) candidate.searchParams.set("tunelito_key", accessKey);
  const hostname = candidate.hostname;
  const startedAt = now();
  const deadline = startedAt + Math.max(0, timeoutMs);
  let delayMs = Math.max(0, retryMs);
  let lastFailure = null;
  let reportedDnsWait = false;

  const attempt = async (lookup) => {
    const response = await requestFn(candidate, {
      method: "HEAD",
      timeoutMs: Math.min(Math.max(1, deadline - now()), Math.max(1, requestTimeoutMs)),
      signal,
      ...(lookup ? { lookup } : {}),
    });
    if (response.status === 200 && response.headers.get(TUNELITO_RESPONSE_HEADER) === "1") return null;
    return {
      code: response.status === 200 ? "MISSING_MARKER" : `HTTP_${response.status}`,
      detail: `HTTP ${response.status} without the Tunelito marker`,
    };
  };

  do {
    if (signal?.aborted) throw cancelledError(hostname);
    let failure;
    try {
      failure = await attempt(null);
    } catch (error) {
      failure = describeFailure(error);
      if (DNS_NOT_READY_CODES.has(failure.code)) {
        if (!reportedDnsWait) {
          reportedDnsWait = true;
          onProgress?.({ type: "dns-wait", hostname, code: failure.code });
        }
        failure = await attemptViaPublicDns({ failure, hostname, resolveFn, attempt, signal });
      }
    }
    if (!failure) return;
    lastFailure = failure;

    const waitMs = Math.min(delayMs, Math.max(0, deadline - now()));
    if (waitMs > 0) await sleepFn(waitMs, signal);
    delayMs = Math.min(Math.max(delayMs * 2, 1), Math.max(retryMs, maxRetryMs));
  } while (now() < deadline);

  if (signal?.aborted) throw cancelledError(hostname);
  const seconds = Math.round((now() - startedAt) / 1000);
  const error = new Error(`Quick Tunnel ${hostname} did not route to Tunelito before verification timed out after ${seconds}s${lastFailure ? ` (${lastFailure.code}: ${lastFailure.detail})` : ""}.`);
  error.code = "TUNNEL_VERIFICATION_TIMEOUT";
  if (lastFailure) error.causeCode = lastFailure.code;
  throw error;
}

async function attemptViaPublicDns({ failure, hostname, resolveFn, attempt, signal }) {
  if (typeof resolveFn !== "function" || signal?.aborted) return failure;
  let addresses;
  try {
    addresses = (await resolveFn(hostname)).filter((address) => isIP(address));
  } catch (error) {
    return { code: failure.code, detail: `${failure.detail}; public DNS fallback: ${describeFailure(error).code}` };
  }
  if (!addresses.length) {
    return { code: failure.code, detail: `${failure.detail}; public DNS fallback returned no addresses` };
  }
  try {
    const fallbackFailure = await attempt(pinnedLookup(addresses[0]));
    if (!fallbackFailure) return null;
    return { code: fallbackFailure.code, detail: `${fallbackFailure.detail} via public DNS` };
  } catch (error) {
    const fallbackFailure = describeFailure(error);
    return { code: fallbackFailure.code, detail: `${fallbackFailure.detail} via public DNS` };
  }
}

/** A `lookup` override that answers every query with one pre-resolved address. */
export function pinnedLookup(address) {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    if (options && typeof options === "object" && options.all) {
      done(null, [{ address, family }]);
    } else {
      done(null, address, family);
    }
  };
}

function describeFailure(error) {
  const root = error?.cause && typeof error.cause === "object" ? error.cause : error;
  if (error?.name === "AbortError" || root?.name === "AbortError" || root?.code === "ETIMEDOUT_REQUEST") {
    return { code: "ETIMEDOUT", detail: "request timed out" };
  }
  return {
    code: String(root?.code || error?.code || "EUNKNOWN"),
    detail: String(root?.message || error?.message || "request failed"),
  };
}

function cancelledError(hostname) {
  const error = new Error(`Quick Tunnel ${hostname} verification was cancelled`);
  error.code = "ABORT_ERR";
  return error;
}

/** Resolve a hostname directly against public DNS, bypassing the OS resolver cache. */
export async function resolvePublicDns(hostname, { servers = PUBLIC_DNS_SERVERS } = {}) {
  const resolver = new Resolver({ timeout: 2_000, tries: 2 });
  resolver.setServers(servers);
  const query = (method) => new Promise((resolveAddresses, rejectAddresses) => {
    resolver[method](hostname, (error, addresses) => (error ? rejectAddresses(error) : resolveAddresses(addresses)));
  });
  try {
    return await query("resolve4");
  } catch (error) {
    try {
      const addresses = await query("resolve6");
      if (addresses.length) return addresses;
    } catch {
      // Report the IPv4 failure; Quick Tunnel hostnames publish A records.
    }
    throw error;
  }
}

/**
 * Minimal HTTPS request used for tunnel verification. It never follows
 * redirects, always validates certificates, and supports a `lookup` override
 * so the caller can connect to a publicly resolved address while TLS SNI,
 * certificate checks, and the Host header still use the URL hostname.
 */
export function headRequest(url, { method = "HEAD", timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal, lookup } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const target = new URL(url);
    const request = httpsRequest({
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      servername: isIP(target.hostname) ? undefined : target.hostname,
      headers: { "user-agent": "tunelito-tunnel-verify" },
      agent: false,
      signal,
      ...(lookup ? { lookup } : {}),
    }, (response) => {
      const headers = response.headers;
      resolveResponse({
        status: response.statusCode,
        headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
      });
      response.destroy();
    });
    request.setTimeout(Math.max(1, timeoutMs), () => {
      request.destroy(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT_REQUEST" }));
    });
    request.on("error", rejectResponse);
    request.end();
  });
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

function sleep(milliseconds, signal) {
  return new Promise((resolveDelay) => {
    if (signal?.aborted) {
      resolveDelay();
      return;
    }
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolveDelay();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
