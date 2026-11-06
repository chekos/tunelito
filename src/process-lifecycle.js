import { ChildProcess } from "node:child_process";

const owned = new Set();
const groups = new WeakSet();
export const OWNED_PROCESS_OPTIONS = { detached: process.platform !== "win32" };

export function ownChild(child) {
  if (!child) return child;
  owned.add(child);
  if (child instanceof ChildProcess && OWNED_PROCESS_OPTIONS.detached && child.pid) groups.add(child);
  child.once("close", () => {
    // A shell can finish while a background descendant remains in its group.
    // Reap that group immediately, before forgetting its ownership.
    if (groups.has(child)) {
      try { signalChild(child, "SIGKILL"); } catch { /* shutdown will retry while owned */ }
      groups.delete(child);
    }
    owned.delete(child);
  });
  child.once("error", () => { if (!child.pid) owned.delete(child); });
  return child;
}

function signalChild(child, signal) {
  try {
    if (groups.has(child)) process.kill(-child.pid, signal);
    else if (child.exitCode == null && child.signalCode == null) child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export function forceOwnedChildren() {
  for (const child of owned) {
    try { signalChild(child, "SIGKILL"); } catch { /* continue stopping other owned children */ }
  }
}

// Await confirmation, escalate locally, and never infer anything about work
// already submitted by a provider CLI to a remote service.
export async function stopOwnedChild(child, { graceMs = 1000, killMs = 500 } = {}) {
  if (!child) return;
  if (child.exitCode != null || child.signalCode != null) {
    if (groups.has(child)) signalChild(child, "SIGKILL");
    return;
  }
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const onExit = () => resolveExit(true);
  child.once("exit", onExit);
  child.once("close", onExit);
  let timer;
  const wait = (ms) => Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })]);
  try {
    signalChild(child, "SIGTERM");
    const graceful = await wait(graceMs);
    clearTimeout(timer);
    // Also reap any descendants left in our dedicated process group after
    // the leader exits. Never signal the caller's or an unrelated group.
    if (!graceful || groups.has(child)) signalChild(child, "SIGKILL");
    if (!graceful && !await wait(killMs)) throw new Error("Owned child exit was not confirmed after SIGKILL");
  } finally {
    clearTimeout(timer);
    child.removeListener("exit", onExit);
    child.removeListener("close", onExit);
  }
}

export const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

export function createShutdownHandler({ cleanup, stopped, failure, drain, restore = () => {},
  force = forceOwnedChildren, exit = (code) => process.exit(code), timeoutMs = 5000 }) {
  let shuttingDown = false;
  let deadline;
  let failureReported = false;
  const report = (...args) => {
    if (failureReported) return;
    failureReported = true;
    failure(...args);
  };
  return async (signal = "SIGTERM") => {
    const code = SIGNAL_EXIT_CODES[signal] || 1;
    if (shuttingDown) {
      clearTimeout(deadline);
      force();
      restore();
      report("CANCELLED", `${signal}: forced local exit; cleanup and remote provider work are not confirmed stopped.`, code);
      exit(code);
      return;
    }
    shuttingDown = true;
    deadline = setTimeout(() => {
      force();
      restore();
      report("SHUTDOWN_TIMEOUT", "Local cleanup or output drain exceeded the shutdown deadline; remote work may still be running.", code);
      exit(code);
    }, timeoutMs);
    try {
      const results = await cleanup();
      const errors = results.filter((result) => result.status === "rejected");
      if (errors.length) report("CLEANUP_FAILED", "Some local cleanup could not be confirmed; remote work may still be running.", code);
      else report("CANCELLED", `${signal}: local cleanup completed. Remote provider work is not confirmed stopped.`, code);
      restore();
      stopped({ signal, exitCode: code, cleanup: errors.length ? "incomplete" : "complete" });
      await drain();
      clearTimeout(deadline);
      exit(code);
    } catch {
      force();
      restore();
      report("CLEANUP_FAILED", "Local cleanup failed; remote work may still be running.", code);
      clearTimeout(deadline);
      exit(code);
    }
  };
}
