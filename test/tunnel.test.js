import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cloudflaredFallbackPackage, cloudflaredNpxArgs, startCloudflareTunnel, verifyTunelitoTunnel } from "../src/tunnel.js";

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

  const tunnel = startCloudflareTunnel({
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
  tunnel.stop();
});

test("startCloudflareTunnel ignores the provisioning endpoint and verifies the created Quick Tunnel", async () => {
  const child = fakeChild();
  const verified = [];
  const published = new Promise((resolvePublished, rejectPublished) => {
    startCloudflareTunnel({
      localUrl: "http://127.0.0.1:4317/",
      accessKey: "review-secret",
      spawnFn() {
        return child;
      },
      async verifyFn(input) {
        verified.push(input);
      },
      onUrl: resolvePublished,
      onError: rejectPublished,
    });
  });

  child.stdout.emit("data", "Requesting new quick Tunnel on https://api.trycloudflare.com...\n");
  child.stdout.emit("data", "\u001b[32mYour quick Tunnel has been created!\u001b[0m\n");
  child.stderr.emit("data", "https://rough-accounting-undefined-raymond.trycloudflare.com\n");
  child.stderr.emit("data", "Registered tunnel connection connIndex=0 protocol=quic\n");

  assert.equal(await published, "https://rough-accounting-undefined-raymond.trycloudflare.com");
  assert.equal(verified.length, 1);
  assert.equal(verified[0].url, "https://rough-accounting-undefined-raymond.trycloudflare.com");
  assert.equal(verified[0].accessKey, "review-secret");
});

test("startCloudflareTunnel parses the created URL across every chunk boundary and emits it once", async () => {
  const transcript = [
    "Requesting new quick Tunnel on https://api.trycloudflare.com...",
    "\u001b[32mYour quick Tunnel has been created!\u001b[0m",
    "https://chunk-safe-tunnel.trycloudflare.com",
    "Registered tunnel connection connIndex=0 protocol=quic",
    "https://chunk-safe-tunnel.trycloudflare.com",
    "",
  ].join("\n");

  for (let split = 1; split < transcript.length; split += 1) {
    const child = fakeChild();
    const urls = [];
    const published = new Promise((resolvePublished, rejectPublished) => {
      startCloudflareTunnel({
        localUrl: "http://127.0.0.1:4317/",
        spawnFn() {
          return child;
        },
        async verifyFn() {},
        onUrl(url) {
          urls.push(url);
          resolvePublished(url);
        },
        onError: rejectPublished,
      });
    });

    child.stderr.emit("data", transcript.slice(0, split));
    child.stderr.emit("data", transcript.slice(split));

    assert.equal(await published, "https://chunk-safe-tunnel.trycloudflare.com");
    await Promise.resolve();
    assert.deepEqual(urls, ["https://chunk-safe-tunnel.trycloudflare.com"]);
  }
});

test("startCloudflareTunnel bounds discovery when cloudflared never registers", async () => {
  const child = fakeChild();
  const failed = new Promise((resolveFailure) => {
    startCloudflareTunnel({
      localUrl: "http://127.0.0.1:4317/",
      discoveryTimeoutMs: 5,
      spawnFn() {
        return child;
      },
      onError: resolveFailure,
    });
  });

  child.stderr.emit("data", "Your quick Tunnel has been created!\n");
  child.stderr.emit("data", "https://never-registered.trycloudflare.com\n");

  const error = await failed;
  assert.match(error.message, /did not produce and register a Quick Tunnel before startup timed out/);
  assert.equal(child.killed, true);
});

test("verifyTunelitoTunnel requires an authenticated Tunelito marker", async () => {
  const requests = [];
  let attempt = 0;
  await verifyTunelitoTunnel({
    url: "https://verified.trycloudflare.com",
    accessKey: "review-secret",
    timeoutMs: 100,
    retryMs: 0,
    async fetchFn(url, options) {
      requests.push({ url: url.toString(), options });
      attempt += 1;
      return attempt === 1
        ? new Response(null, { status: 503 })
        : new Response(null, {
            status: 200,
            headers: { "x-tunelito-review": "1" },
          });
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(requests[0].options.redirect, "manual");
  assert.match(requests[0].url, /tunelito_key=review-secret/);
});

test("verifyTunelitoTunnel rejects a generic reachable endpoint", async () => {
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://generic.trycloudflare.com",
      timeoutMs: 0,
      async fetchFn() {
        return new Response(null, { status: 200 });
      },
    }),
    /did not route to Tunelito.*HTTP 200 without the Tunelito marker/,
  );
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
