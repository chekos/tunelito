#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const binPath = resolve(rootDir, "bin/tunelito.js");
const tempRoot = mkdtempSync(join(tmpdir(), "tunelito-smoke-"));
const examplePath = join(tempRoot, "simple-review.html");
const timeoutMs = 5000;
copyFileSync(resolve(rootDir, "examples/simple-review.html"), examplePath);

let child;

try {
  const localUrl = await startTunelito();
  await verifySmoke(localUrl);
  console.log(`Smoke check passed for ${localUrl}`);
} finally {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolveExit) => setTimeout(resolveExit, 1000)),
    ]);
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

async function startTunelito() {
  child = spawn(process.execPath, [binPath, examplePath, "--no-tunnel", "--port", "0"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    return await new Promise((resolveLocalUrl, reject) => {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/^Local:\s+(\S+)/m);
        if (match) {
          clearTimeout(timer);
          resolveLocalUrl(match[1]);
        }
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        reject(new Error(`Tunelito exited before printing a local URL (${signal || code}). ${stderr.trim()}`));
      });
    });
  } finally {
    clearTimeout(timer);
  }
}

async function verifySmoke(localUrl) {
  const page = await fetch(localUrl);
  assertStatus(page, 200, "keyed page");
  const html = await page.text();
  assertIncludes(html, "/__tunelito/client.js", "served HTML includes the injected client route");

  const clientUrl = keyedEndpoint("/__tunelito/client.js", localUrl);
  const client = await fetch(clientUrl);
  assertStatus(client, 200, "client script");
  assertIncludes(await client.text(), "tunelito-root", "client script contains the Tunelito root mount");

  const commentsUrl = keyedEndpoint("/__tunelito/comments.md", localUrl);
  const comments = await fetch(commentsUrl);
  assertStatus(comments, 200, "comments endpoint");
  assertIncludes(await comments.text(), "# Tunelito comments", "comments endpoint returns markdown");
}

function keyedEndpoint(pathname, localUrl) {
  const keyedUrl = new URL(localUrl);
  const endpoint = new URL(pathname, keyedUrl);
  endpoint.search = keyedUrl.search;
  return endpoint;
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}; expected ${expected}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label}: missing ${expected}`);
  }
}
