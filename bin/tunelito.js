#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createTunelitoServer } from "../src/server.js";
import { startCloudflareTunnel } from "../src/tunnel.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = pkg.version;

function usage() {
  return `Tunelito ${VERSION}

Usage: tunelito <page.html> [options]

Options:
  --port <number>       Port to listen on (default: first free from 4317)
  --host <host>         Host to bind locally (default: 127.0.0.1)
  --out <path>          Markdown comments file (default: <page>.comments.md)
  --no-tunnel           Only print the local URL; do not start Cloudflare Tunnel
  --no-auth             Disable the generated review-key URL gate
  --open                Open the local URL in your default browser
  -v, --version         Show version
  -h, --help            Show this help
`;
}

export function parseArgs(argv) {
  const opts = {
    host: "127.0.0.1",
    port: 4317,
    tunnel: true,
    auth: true,
    open: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "-v" || arg === "--version") {
      opts.version = true;
    } else if (arg === "--no-tunnel") {
      opts.tunnel = false;
    } else if (arg === "--no-auth") {
      opts.auth = false;
    } else if (arg === "--open") {
      opts.open = true;
    } else if (arg === "--port") {
      const value = argv[++i];
      const port = Number.parseInt(value, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      opts.port = port;
    } else if (arg === "--host") {
      opts.host = argv[++i];
      if (!opts.host) throw new Error("--host requires a value");
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--out requires a value");
      opts.commentsPath = resolve(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(`Expected one HTML file, got ${positional.length}`);
  }
  if (positional[0]) opts.filePath = resolve(positional[0]);
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  if (opts.help) {
    console.log(usage());
    return;
  }

  if (opts.version) {
    console.log(VERSION);
    return;
  }

  if (!opts.filePath) {
    console.error("Missing HTML file.");
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  if (!existsSync(opts.filePath)) {
    console.error(`File not found: ${opts.filePath}`);
    process.exit(1);
  }
  if (!statSync(opts.filePath).isFile()) {
    console.error(`Not a file: ${opts.filePath}`);
    process.exit(1);
  }

  const accessKey = opts.auth ? generateAccessKey() : null;
  const instance = await createTunelitoServer({
    filePath: opts.filePath,
    commentsPath: opts.commentsPath,
    host: opts.host,
    port: opts.port,
    accessKey,
  });

  let tunnel = null;
  let shuttingDown = false;

  instance.events.on("viewer-count", (count) => {
    console.log(`Viewers: ${count}`);
  });
  instance.events.on("comment", (comment) => {
    console.log(`Comment from ${comment.author}: ${comment.quote.slice(0, 80).replace(/\s+/g, " ")}`);
  });
  instance.events.on("document-changed", () => {
    console.log("HTML changed on disk; connected browsers were asked to reload.");
  });

  console.log("Tunelito is running");
  console.log(`Local:   ${instance.localUrl}`);
  console.log(`Comments: ${instance.commentsPath}`);
  console.log(opts.auth ? "Access:  review key required by the printed URLs" : "Access:  disabled (--no-auth)");

  if (opts.open) {
    openBrowser(instance.localUrl);
  }

  if (opts.tunnel) {
    console.log("Public:  starting Cloudflare Tunnel...");
    tunnel = startCloudflareTunnel({
      localUrl: instance.originUrl,
      onUrl(url) {
        console.log(`Public:  ${withReviewKey(url, accessKey)}`);
      },
      onFallback(fallbackPackage) {
        console.log(`Public:  cloudflared not found; trying npx ${fallbackPackage}...`);
      },
      onError(error) {
        console.log(`Public:  unavailable (${error.message})`);
        console.log("         Install cloudflared, allow npm/npx network access, or rerun with --no-tunnel.");
      },
    });
  } else {
    console.log("Public:  disabled (--no-tunnel)");
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down Tunelito...");
    if (tunnel) tunnel.stop();
    await instance.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function openBrowser(url, { platform = process.platform, spawnFn = spawn, log = console.log } = {}) {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawnFn(command, args, { stdio: "ignore", detached: true });
  child.on("error", (error) => {
    log(`Open:    could not launch browser (${error.message})`);
  });
  child.unref();
  return child;
}

export function generateAccessKey(randomFn = randomBytes) {
  return randomFn(18).toString("base64url");
}

export function withReviewKey(url, accessKey) {
  const parsed = new URL(url);
  if (accessKey) parsed.searchParams.set("tunelito_key", accessKey);
  return parsed.toString();
}

export function isCliEntry(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  const directPath = pathToFileURL(argvPath).href;
  let realPath = directPath;
  try {
    realPath = pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    // If argvPath cannot be resolved, the direct comparison is still useful.
  }
  return metaUrl === directPath || metaUrl === realPath;
}

if (isCliEntry(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
