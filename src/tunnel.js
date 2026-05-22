import { spawn } from "node:child_process";

const TRY_CLOUDFLARE_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;
const DEFAULT_CLOUDFLARED_PACKAGE = "cloudflared@latest";

export function startCloudflareTunnel({ localUrl, onUrl, onError, onFallback, env = process.env, spawnFn = spawn }) {
  let child = null;
  let emittedUrl = false;
  let startupError = null;
  let triedNpx = false;
  let stopped = false;
  const fallbackPackage = cloudflaredFallbackPackage(env);

  function inspect(data) {
    const text = data.toString();
    const match = text.match(TRY_CLOUDFLARE_URL);
    if (match && !emittedUrl) {
      emittedUrl = true;
      onUrl?.(match[0]);
    }
  }

  function launch(command, args) {
    child = spawnFn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.on("error", (error) => {
      if (error.code === "ENOENT" && !triedNpx) {
        triedNpx = true;
        onFallback?.(fallbackPackage);
        launch("npx", cloudflaredNpxArgs({ localUrl, packageName: fallbackPackage }));
        return;
      }
      startupError = error;
      onError?.(error);
    });
    child.on("exit", (code, signal) => {
      if (!stopped && !emittedUrl && !startupError) {
        onError?.(new Error(`${command} exited before publishing a URL (${signal || code})`));
      }
    });
  }

  launch("cloudflared", ["tunnel", "--url", localUrl]);

  return {
    get process() {
      return child;
    },
    stop() {
      stopped = true;
      if (child && !child.killed) child.kill("SIGTERM");
    },
  };
}

export function cloudflaredFallbackPackage(env = process.env) {
  return String(env.TUNELITO_CLOUDFLARED_PACKAGE || "").trim() || DEFAULT_CLOUDFLARED_PACKAGE;
}

export function cloudflaredNpxArgs({ localUrl, packageName = DEFAULT_CLOUDFLARED_PACKAGE }) {
  return ["--yes", packageName, "tunnel", "--url", localUrl];
}
