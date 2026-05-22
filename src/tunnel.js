import { spawn } from "node:child_process";

const TRY_CLOUDFLARE_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

export function startCloudflareTunnel({ localUrl, onUrl, onError, onFallback }) {
  let child = null;
  let emittedUrl = false;
  let startupError = null;
  let triedNpx = false;
  let stopped = false;

  function inspect(data) {
    const text = data.toString();
    const match = text.match(TRY_CLOUDFLARE_URL);
    if (match && !emittedUrl) {
      emittedUrl = true;
      onUrl?.(match[0]);
    }
  }

  function launch(command, args) {
    child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.on("error", (error) => {
      if (error.code === "ENOENT" && !triedNpx) {
        triedNpx = true;
        onFallback?.();
        launch("npx", ["--yes", "cloudflared@latest", "tunnel", "--url", localUrl]);
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
