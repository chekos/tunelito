import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cloudflaredFallbackPackage, cloudflaredNpxArgs, startCloudflareTunnel } from "../src/tunnel.js";

test("cloudflared fallback package defaults to latest", () => {
  assert.equal(cloudflaredFallbackPackage({}), "cloudflared@latest");
  assert.deepEqual(cloudflaredNpxArgs({ localUrl: "http://127.0.0.1:4317/" }), [
    "--yes",
    "cloudflared@latest",
    "tunnel",
    "--url",
    "http://127.0.0.1:4317/",
  ]);
});

test("cloudflared fallback package can be pinned with an environment variable", () => {
  const env = {
    TUNELITO_CLOUDFLARED_PACKAGE: " cloudflared@2026.5.0 ",
  };

  assert.equal(cloudflaredFallbackPackage(env), "cloudflared@2026.5.0");
  assert.deepEqual(cloudflaredNpxArgs({
    localUrl: "http://127.0.0.1:4317/",
    packageName: cloudflaredFallbackPackage(env),
  }), [
    "--yes",
    "cloudflared@2026.5.0",
    "tunnel",
    "--url",
    "http://127.0.0.1:4317/",
  ]);
});

test("startCloudflareTunnel uses the pinned package for npx fallback", () => {
  const children = [];
  const calls = [];
  const fallbackPackages = [];

  startCloudflareTunnel({
    localUrl: "http://127.0.0.1:4317/",
    env: { TUNELITO_CLOUDFLARED_PACKAGE: "cloudflared@2026.5.0" },
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    onFallback(packageName) {
      fallbackPackages.push(packageName);
    },
    onError(error) {
      throw error;
    },
  });

  children[0].emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));

  assert.deepEqual(fallbackPackages, ["cloudflared@2026.5.0"]);
  assert.deepEqual(calls, [
    {
      command: "cloudflared",
      args: ["tunnel", "--url", "http://127.0.0.1:4317/"],
      options: { stdio: ["ignore", "pipe", "pipe"] },
    },
    {
      command: "npx",
      args: ["--yes", "cloudflared@2026.5.0", "tunnel", "--url", "http://127.0.0.1:4317/"],
      options: { stdio: ["ignore", "pipe", "pipe"] },
    },
  ]);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}
