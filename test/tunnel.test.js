import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cloudflaredFallbackPackage, cloudflaredNpxArgs, headRequest, startCloudflareTunnel, verifyTunelitoTunnel } from "../src/tunnel.js";

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

test("startCloudflareTunnel reports runtime loss after publishing a verified URL", async () => {
  const child = fakeChild();
  let published = "";
  const runtimeFailure = new Promise((resolveFailure) => {
    startCloudflareTunnel({
      localUrl: "http://127.0.0.1:4317/",
      spawnFn() {
        return child;
      },
      async verifyFn() {},
      onUrl(url) {
        published = url;
      },
      onError: resolveFailure,
    });
  });

  child.stderr.emit("data", "Your quick Tunnel has been created!\n");
  child.stderr.emit("data", "https://runtime-loss.trycloudflare.com\n");
  child.stderr.emit("data", "Registered tunnel connection connIndex=0 protocol=quic\n");
  await Promise.resolve();
  assert.equal(published, "https://runtime-loss.trycloudflare.com");

  child.emit("exit", 1, null);
  const error = await runtimeFailure;
  assert.match(error.message, /exited after publishing the verified tunnel URL/);
});

test("startCloudflareTunnel forwards DNS progress and does not publish before verification", async () => {
  const child = fakeChild();
  const progress = [];
  const urls = [];
  let finishVerification;
  startCloudflareTunnel({
    localUrl: "http://127.0.0.1:4317/",
    spawnFn() {
      return child;
    },
    verifyFn({ onProgress }) {
      onProgress({ type: "dns-wait", hostname: "slow-dns.trycloudflare.com", code: "ENOTFOUND" });
      return new Promise((resolveVerification) => {
        finishVerification = resolveVerification;
      });
    },
    onProgress(event) {
      progress.push(event);
    },
    onUrl(url) {
      urls.push(url);
    },
    onError(error) {
      throw error;
    },
  });

  child.stderr.emit("data", "Your quick Tunnel has been created!\n");
  child.stderr.emit("data", "https://slow-dns.trycloudflare.com\n");
  child.stderr.emit("data", "Registered tunnel connection connIndex=0 protocol=quic\n");
  await Promise.resolve();

  assert.deepEqual(progress, [{ type: "dns-wait", hostname: "slow-dns.trycloudflare.com", code: "ENOTFOUND" }]);
  assert.deepEqual(urls, []);
  finishVerification();
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.deepEqual(urls, ["https://slow-dns.trycloudflare.com"]);
});

test("startCloudflareTunnel cancels verification when cloudflared exits mid-verification", async () => {
  const child = fakeChild();
  const urls = [];
  const failed = new Promise((resolveFailure) => {
    startCloudflareTunnel({
      localUrl: "http://127.0.0.1:4317/",
      spawnFn() {
        return child;
      },
      verifyFn: (input) => verifyTunelitoTunnel({
        ...input,
        async requestFn() {
          throw dnsError("ENOTFOUND");
        },
        async resolveFn() {
          throw dnsError("ENOTFOUND");
        },
      }),
      onUrl(url) {
        urls.push(url);
      },
      onError: resolveFailure,
    });
  });

  child.stderr.emit("data", "Your quick Tunnel has been created!\n");
  child.stderr.emit("data", "https://exits-early.trycloudflare.com\n");
  child.stderr.emit("data", "Registered tunnel connection connIndex=0 protocol=quic\n");
  await new Promise((resolveTick) => setImmediate(resolveTick));
  child.emit("exit", 1, null);

  const error = await failed;
  assert.match(error.message, /cloudflared exited before the Quick Tunnel was verified/);
  assert.deepEqual(urls, []);
});

test("verifyTunelitoTunnel requires an authenticated Tunelito marker", async () => {
  const requests = [];
  let attempt = 0;
  await verifyTunelitoTunnel({
    url: "https://verified.trycloudflare.com",
    accessKey: "review-secret",
    timeoutMs: 100,
    retryMs: 0,
    async requestFn(url, options) {
      requests.push({ url: url.toString(), options });
      attempt += 1;
      return attempt === 1 ? fakeResponse(503) : fakeResponse(200, { "x-tunelito-review": "1" });
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(requests[0].options.lookup, undefined);
  assert.match(requests[0].url, /tunelito_key=review-secret/);
});

test("verifyTunelitoTunnel rejects a generic reachable endpoint", async () => {
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://generic.trycloudflare.com",
      timeoutMs: 0,
      async requestFn() {
        return fakeResponse(200);
      },
    }),
    (error) => {
      assert.match(error.message, /did not route to Tunelito.*MISSING_MARKER: HTTP 200 without the Tunelito marker/);
      assert.equal(error.causeCode, "MISSING_MARKER");
      return true;
    },
  );
});

test("verifyTunelitoTunnel waits out an initial ENOTFOUND and then succeeds", async () => {
  const clock = fakeClock();
  const progress = [];
  let attempts = 0;
  await verifyTunelitoTunnel({
    url: "https://cached-negative.trycloudflare.com",
    accessKey: "review-secret",
    ...clock,
    onProgress(event) {
      progress.push(event);
    },
    async resolveFn() {
      throw dnsError("ENOTFOUND");
    },
    async requestFn() {
      attempts += 1;
      // Simulate ~60s of cached negative answers before the OS resolver catches up.
      if (clock.now() < 60_000) throw fetchStyleError(dnsError("ENOTFOUND"));
      return fakeResponse(200, { "x-tunelito-review": "1" });
    },
  });

  assert.ok(clock.now() >= 60_000);
  assert.ok(clock.now() < 120_000);
  assert.ok(attempts > 2);
  assert.deepEqual(progress, [{ type: "dns-wait", hostname: "cached-negative.trycloudflare.com", code: "ENOTFOUND" }]);
  assert.ok(clock.sleeps.every((ms) => ms <= 3_000), "retry backoff stays bounded");
  assert.ok(clock.sleeps.at(-1) > clock.sleeps[0], "retry delay backs off");
});

test("verifyTunelitoTunnel connects through public DNS with the original hostname when the OS resolver fails", async () => {
  const requests = [];
  const resolved = [];
  await verifyTunelitoTunnel({
    url: "https://fresh-host.trycloudflare.com",
    accessKey: "review-secret",
    ...fakeClock(),
    async resolveFn(hostname) {
      resolved.push(hostname);
      return ["104.16.230.132", "104.16.231.132"];
    },
    async requestFn(url, options) {
      requests.push({ url: url.toString(), options });
      if (!options.lookup) throw dnsError("ENOTFOUND");
      return fakeResponse(200, { "x-tunelito-review": "1" });
    },
  });

  assert.deepEqual(resolved, ["fresh-host.trycloudflare.com"]);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).hostname, "fresh-host.trycloudflare.com");
  assert.match(requests[1].url, /tunelito_key=review-secret/);

  const single = await new Promise((resolveLookup) => {
    requests[1].options.lookup("fresh-host.trycloudflare.com", {}, (error, address, family) => resolveLookup({ error, address, family }));
  });
  assert.deepEqual(single, { error: null, address: "104.16.230.132", family: 4 });
  const all = await new Promise((resolveLookup) => {
    requests[1].options.lookup("fresh-host.trycloudflare.com", { all: true }, (error, addresses) => resolveLookup({ error, addresses }));
  });
  assert.deepEqual(all, { error: null, addresses: [{ address: "104.16.230.132", family: 4 }] });
});

test("verifyTunelitoTunnel still requires the marker on the public DNS path", async () => {
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://wrong-origin.trycloudflare.com",
      ...fakeClock(),
      timeoutMs: 2_000,
      async resolveFn() {
        return ["104.16.230.132"];
      },
      async requestFn(_url, options) {
        if (!options.lookup) throw dnsError("ENOTFOUND");
        return fakeResponse(404);
      },
    }),
    /HTTP_404: HTTP 404 without the Tunelito marker via public DNS/,
  );
});

test("verifyTunelitoTunnel only retries public DNS for resolver failures", async () => {
  let resolverCalls = 0;
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://tls-broken.trycloudflare.com",
      ...fakeClock(),
      timeoutMs: 1_000,
      async resolveFn() {
        resolverCalls += 1;
        return ["104.16.230.132"];
      },
      async requestFn() {
        throw Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
      },
    }),
    (error) => {
      assert.match(error.message, /ERR_TLS_CERT_ALTNAME_INVALID/);
      assert.equal(error.causeCode, "ERR_TLS_CERT_ALTNAME_INVALID");
      return true;
    },
  );
  assert.equal(resolverCalls, 0);
});

test("verifyTunelitoTunnel fails within its bounded window and names the DNS cause", async () => {
  const clock = fakeClock();
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://never-routes.trycloudflare.com",
      ...clock,
      async resolveFn() {
        throw dnsError("ENOTFOUND");
      },
      async requestFn() {
        throw fetchStyleError(dnsError("ENOTFOUND"));
      },
    }),
    (error) => {
      assert.match(error.message, /never-routes\.trycloudflare\.com did not route to Tunelito before verification timed out after 120s/);
      assert.match(error.message, /ENOTFOUND: getaddrinfo ENOTFOUND/);
      assert.match(error.message, /public DNS fallback: ENOTFOUND/);
      assert.equal(error.code, "TUNNEL_VERIFICATION_TIMEOUT");
      assert.equal(error.causeCode, "ENOTFOUND");
      return true;
    },
  );
  assert.ok(clock.now() >= 120_000 && clock.now() < 125_000);
});

test("verifyTunelitoTunnel times out a request that stalls before connecting", async () => {
  const started = Date.now();
  let attempts = 0;
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://stalled-lookup.trycloudflare.com",
      timeoutMs: 120,
      requestTimeoutMs: 20,
      retryMs: 0,
      requestFn() {
        attempts += 1;
        return new Promise(() => {});
      },
    }),
    (error) => {
      assert.match(error.message, /ETIMEDOUT: request timed out/);
      assert.equal(error.causeCode, "ETIMEDOUT");
      return true;
    },
  );
  assert.ok(attempts >= 1);
  assert.ok(Date.now() - started < 2_000, "stalled requests do not outlive the deadline");
});

test("headRequest timeout covers a stalled DNS lookup", async () => {
  const started = Date.now();
  await assert.rejects(
    headRequest(new URL("https://stalled-lookup.trycloudflare.com/"), {
      timeoutMs: 30,
      lookup() {
        // Never call back: simulates getaddrinfo hanging.
      },
    }),
    (error) => {
      assert.equal(error.code, "ETIMEDOUT_REQUEST");
      return true;
    },
  );
  assert.ok(Date.now() - started < 1_000);
});

test("verifyTunelitoTunnel stops promptly when cancelled", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    verifyTunelitoTunnel({
      url: "https://cancelled.trycloudflare.com",
      ...fakeClock(),
      signal: controller.signal,
      async resolveFn() {
        return [];
      },
      async requestFn() {
        attempts += 1;
        if (attempts === 2) controller.abort();
        throw dnsError("EAI_AGAIN");
      },
    }),
    /verification was cancelled/,
  );
  assert.equal(attempts, 2);
});

function fakeResponse(status, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { status, headers: { get: (name) => lower[name.toLowerCase()] ?? null } };
}

function dnsError(code) {
  return Object.assign(new Error(`getaddrinfo ${code} example.trycloudflare.com`), { code });
}

function fetchStyleError(cause) {
  return new TypeError("fetch failed", { cause });
}

function fakeClock() {
  let current = 0;
  const sleeps = [];
  return {
    sleeps,
    now: () => current,
    async sleepFn(ms) {
      sleeps.push(ms);
      current += ms;
    },
  };
}

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
