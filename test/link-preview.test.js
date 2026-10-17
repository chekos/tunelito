import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LINK_PREVIEW_ROUTE,
  buildResolverUrl,
  createBoundedMatcher,
  createLinkPreviewResolver,
  createPinnedFetch,
  enforceLinkPreviewHostPolicy,
  extractLinkPreviewFields,
  isAllowedResolverAddress,
  normalizeLinkPreviewRules,
  parseLinkPreviewFieldsArg,
  MATCH_TIMED_OUT,
  resolvePinnedAddresses,
} from "../src/link-preview.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createTunelitoServer } from "../src/server.js";
import { parseArgs } from "../bin/tunelito.js";

const TRACKER_RULE = {
  match: "^http://127\\.0\\.0\\.1:3100/(?<team>[A-Z]+)/issues/([A-Z]+-\\d+)$",
  resolver: "http://127.0.0.1:3100/api/{team}/issues/{2}",
  fields: { title: "title", status: "state.name", priority: "priority.label" },
};

test("normalizeLinkPreviewRules validates shape, placeholders, and fields", () => {
  const [rule] = normalizeLinkPreviewRules([TRACKER_RULE]);
  assert.equal(rule.origin, "http://127.0.0.1:3100");
  assert.deepEqual(rule.fields, TRACKER_RULE.fields);
  assert.deepEqual(normalizeLinkPreviewRules([{ match: "x", resolver: "http://localhost/x" }])[0].fields, {
    title: "title", status: "status", priority: "priority",
  });
  assert.deepEqual(normalizeLinkPreviewRules(undefined), []);

  assert.throws(() => normalizeLinkPreviewRules({}), /must be an array/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "(", resolver: "http://localhost/" }]), /not a valid regular expression/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "x", resolver: "file:///etc/passwd" }]), /absolute http\(s\) URL/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "(.*)", resolver: "http://{1}/x" }]), /placeholders in the scheme or host/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "(.*)", resolver: "http://127.0.0.1{1}/x" }]), /placeholders in the scheme or host/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "x", resolver: "http://user:pw@localhost/" }]), /credentials/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "(a)", resolver: "http://localhost/{2}" }]), /uses \{2\} but match has 1 capture group/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "a", resolver: "http://localhost/{id}" }]), /no group named "id"/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "a", resolver: "http://localhost/", fields: { body: "x" } }]), /supports only title, status, priority/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "a", resolver: "http://localhost/", fields: { title: "a[0]" } }]), /dotted JSON path/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "a", resolver: "http://localhost/", url: "x" }]), /unknown setting "url"/);
  assert.throws(() => normalizeLinkPreviewRules(Array.from({ length: 21 }, () => ({ match: "a", resolver: "http://localhost/" }))), /at most 20 rules/);
});

test("host policy is loopback-only unless remote resolvers are explicitly allowed over https", () => {
  const loopback = normalizeLinkPreviewRules([
    { match: "a", resolver: "http://127.0.0.1:3100/a" },
    { match: "a", resolver: "http://localhost:3100/a" },
    { match: "a", resolver: "http://[::1]:3100/a" },
  ]);
  assert.equal(enforceLinkPreviewHostPolicy(loopback).length, 3);

  const remote = normalizeLinkPreviewRules([{ match: "a", resolver: "https://tracker.example.com/a" }]);
  assert.throws(() => enforceLinkPreviewHostPolicy(remote), /not loopback; pass --link-preview-allow-remote/);
  assert.equal(enforceLinkPreviewHostPolicy(remote, { allowRemote: true }).length, 1);

  const plainRemote = normalizeLinkPreviewRules([{ match: "a", resolver: "http://10.0.0.5/a" }]);
  assert.throws(() => enforceLinkPreviewHostPolicy(plainRemote, { allowRemote: true }), /must use https/);
  const zeroHost = normalizeLinkPreviewRules([{ match: "a", resolver: "http://0.0.0.0/a" }]);
  assert.throws(() => enforceLinkPreviewHostPolicy(zeroHost), /not loopback/);

  for (const host of ["169.254.169.254", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::]"]) {
    const reserved = normalizeLinkPreviewRules([{ match: "a", resolver: `https://${host}/a` }]);
    assert.throws(() => enforceLinkPreviewHostPolicy(reserved, { allowRemote: true }), /not loopback|private, link-local/, `${host} must never be a remote resolver`);
  }
  assert.throws(() => createLinkPreviewResolver({ rules: remote }), /not loopback/, "the library enforces the host policy too");
  assert.equal(createLinkPreviewResolver({ rules: remote, allowRemote: true }).enabled, true);
});

test("buildResolverUrl encodes captures and never changes the resolver origin", () => {
  const [rule] = normalizeLinkPreviewRules([TRACKER_RULE]);
  assert.equal(buildResolverUrl(rule, "http://127.0.0.1:3100/TLL/issues/TLL-563"), "http://127.0.0.1:3100/api/TLL/issues/TLL-563");
  assert.equal(buildResolverUrl(rule, "https://elsewhere.test/TLL/issues/TLL-563"), "");

  const [loose] = normalizeLinkPreviewRules([{ match: "^ref:(.*)$", resolver: "http://127.0.0.1:3100/api/{1}?q={1}" }]);
  assert.equal(buildResolverUrl(loose, "ref:a/../../b?c#d@evil.test"), "http://127.0.0.1:3100/api/a%2F..%2F..%2Fb%3Fc%23d%40evil.test?q=a%2F..%2F..%2Fb%3Fc%23d%40evil.test");
  assert.equal(buildResolverUrl(loose, "ref:.."), "", "dot-segment captures are refused");
  assert.equal(buildResolverUrl(loose, "ref:"), "", "empty captures are refused");
});

test("extractLinkPreviewFields reads own-property paths and returns plain text only", () => {
  const fields = { title: "title", status: "state.name", priority: "labels.0" };
  assert.deepEqual(extractLinkPreviewFields({
    title: "  <img src=x onerror=alert(1)>\n\tFix login  ",
    state: { name: "todo" },
    labels: [3],
  }, fields), { title: "<img src=x onerror=alert(1)> Fix login", status: "todo", priority: "3" });
  assert.equal(extractLinkPreviewFields({ title: { nested: true }, state: null }, fields), null);
  assert.equal(extractLinkPreviewFields({ state: Object.create({ name: "inherited" }) }, fields), null);
  assert.equal(extractLinkPreviewFields({ title: "x".repeat(500) }, fields).title.length, 200);
  assert.equal(extractLinkPreviewFields("not an object", fields), null);
});

test("parseLinkPreviewFieldsArg parses comma mappings", () => {
  assert.deepEqual(parseLinkPreviewFieldsArg("title=name, status=state.name"), { title: "name", status: "state.name" });
  assert.throws(() => parseLinkPreviewFieldsArg("title"), /Invalid --link-preview-fields entry/);
  assert.throws(() => parseLinkPreviewFieldsArg(","), /at least one/);
});

test("parseArgs collects repeatable --link-preview rules with per-rule fields", () => {
  const opts = parseArgs([
    "notes.md",
    "--link-preview", "^a(\\d+)$", "http://127.0.0.1:1/a/{1}",
    "--link-preview-fields", "title=name,status=state",
    "--link-preview", "^b$", "http://127.0.0.1:1/b",
    "--link-preview-visitors",
    "--link-preview-allow-remote",
  ]);
  assert.deepEqual(opts.linkPreviews, [
    { match: "^a(\\d+)$", resolver: "http://127.0.0.1:1/a/{1}", fields: { title: "name", status: "state" } },
    { match: "^b$", resolver: "http://127.0.0.1:1/b" },
  ]);
  assert.equal(opts.linkPreviewVisitors, true);
  assert.equal(opts.linkPreviewAllowRemote, true);
  assert.throws(() => parseArgs(["notes.md", "--link-preview", "^a$"]), /--link-preview requires a resolver URL template/);
  assert.throws(() => parseArgs(["notes.md", "--link-preview-fields", "title=x"]), /must follow the --link-preview rule/);
  assert.throws(() => parseArgs(["notes.md", "--link-preview", "a", "http://127.0.0.1/", "--link-preview-fields", "title=a", "--link-preview-fields", "title=b"]), /given twice/);
  assert.throws(() => parseArgs(["notes.md", "--link-preview-visitors", "--no-auth"]), /requires the review-key gate/);
});

test("resolver fetches JSON once, caches it, and fails closed on unsafe responses", async () => {
  const hits = [];
  const fake = await startFakeResolver((req, res) => {
    hits.push(req.url);
    const route = req.url.split("/").pop();
    if (route === "ok") return sendJson(res, { title: "Fix login", state: { name: "todo" }, priority: { label: "high" } });
    if (route === "vendor") return sendJson(res, { title: "Vendor JSON" }, "application/vnd.api+json; charset=utf-8");
    if (route === "html") return send(res, 200, "<b>hi</b>", "text/html");
    if (route === "big") return sendJson(res, { title: "x".repeat(70 * 1024) });
    if (route === "chunked") {
      res.writeHead(200, { "content-type": "application/json" });
      res.write(`{"title":"${"y".repeat(40 * 1024)}`);
      res.end(`${"y".repeat(40 * 1024)}"}`);
      return;
    }
    if (route === "redirect") return send(res, 302, "", "application/json", { location: "http://127.0.0.1:1/ok" });
    if (route === "missing") return send(res, 404, "{}", "application/json");
    if (route === "invalid") return send(res, 200, "{nope", "application/json");
    if (route === "empty") return sendJson(res, { other: true });
    if (route === "slow") return setTimeout(() => sendJson(res, { title: "late" }), 500);
    send(res, 500, "", "text/plain");
  });
  try {
    const rules = enforceLinkPreviewHostPolicy(normalizeLinkPreviewRules([{
      match: "^tll:(\\w+)$",
      resolver: `${fake.origin}/api/{1}`,
      fields: { title: "title", status: "state.name", priority: "priority.label" },
    }]));
    let clock = 0;
    const resolver = createLinkPreviewResolver({ rules, now: () => clock });
    const impatient = createLinkPreviewResolver({ rules, limits: { timeoutMs: 100 } });
    assert.equal((await impatient.resolve("tll:slow")).status, 502, "slow resolvers time out");

    assert.deepEqual(await resolver.resolve("tll:ok"), { status: 200, body: { title: "Fix login", status: "todo", priority: "high" } });
    assert.deepEqual(await resolver.resolve("tll:ok"), { status: 200, body: { title: "Fix login", status: "todo", priority: "high" } });
    assert.equal(hits.filter((hit) => hit === "/api/ok").length, 1, "fresh results come from the cache");
    clock += 61_000;
    await resolver.resolve("tll:ok");
    assert.equal(hits.filter((hit) => hit === "/api/ok").length, 2, "expired results are refetched");

    assert.equal((await resolver.resolve("tll:vendor")).status, 200, "+json media types are JSON");
    for (const route of ["html", "big", "chunked", "redirect", "missing", "invalid", "boom"]) {
      assert.equal((await resolver.resolve(`tll:${route}`)).status, 502, `${route} must fail closed`);
    }
    assert.equal((await resolver.resolve("tll:empty")).status, 404, "no mapped fields means no card");
    assert.equal((await resolver.resolve("https://not-matching.test/")).status, 404);
    assert.equal((await resolver.resolve(`tll:${"a".repeat(3000)}`)).status, 404, "oversized hrefs are ignored");
    assert.ok(!hits.some((hit) => hit.includes("not-matching")));
  } finally {
    await fake.close();
  }
});

test("resolver bounds concurrent upstream fetches and shares in-flight requests", async () => {
  const releases = [];
  let hits = 0;
  const fakeFetch = (url) => {
    hits += 1;
    return new Promise((resolve) => releases.push(() => resolve(new Response(JSON.stringify({ title: url }), {
      headers: { "content-type": "application/json" },
    }))));
  };
  const rules = normalizeLinkPreviewRules([{ match: "^n:(\\d+)$", resolver: "http://127.0.0.1:9/{1}" }]);
  const resolver = createLinkPreviewResolver({ rules, fetchImpl: fakeFetch, limits: { maxConcurrent: 2 } });
  const first = resolver.resolve("n:1");
  const shared = resolver.resolve("n:1");
  const second = resolver.resolve("n:2");
  assert.deepEqual(await resolver.resolve("n:3"), { status: 503 }, "over-capacity requests are refused, not queued");
  assert.equal(hits, 2);
  releases.forEach((release) => release());
  assert.equal((await first).body.title, "http://127.0.0.1:9/1");
  assert.equal(await shared, await first);
  assert.equal((await second).status, 200);
  const visitorResolver = createLinkPreviewResolver({ rules, fetchImpl: fakeFetch, limits: { maxConcurrent: 2 } });
  const ownerPending = visitorResolver.resolve("n:10", { visitor: true });
  assert.deepEqual(await visitorResolver.resolve("n:11", { visitor: true }), { status: 503 }, "visitors cannot take the owner's reserved slot");
  const ownerReserved = visitorResolver.resolve("n:12");
  assert.deepEqual(await visitorResolver.resolve(`n:${"1".repeat(600)}`, { visitor: true }), { status: 404 }, "visitor hrefs are capped at 512 characters");
  await new Promise((resolve) => setImmediate(resolve));
  releases.slice(-2).forEach((release) => release());
  assert.equal((await ownerPending).status, 200);
  assert.equal((await ownerReserved).status, 200);
  hits -= 2;

  const retry = resolver.resolve("n:3");
  await new Promise((resolve) => setImmediate(resolve));
  releases.at(-1)();
  assert.equal((await retry).status, 200, "503 results are not cached");
  assert.equal(hits, 3);
});

test("link-preview route is keyed, same-origin only, and owner-only by default", async () => {
  const fake = await startFakeResolver((req, res) => sendJson(res, { title: "Fix login", status: "todo", priority: "high" }));
  const dir = mkdtempSync(join(tmpdir(), "tunelito-link-preview-"));
  const markdownPath = join(dir, "notes.md");
  writeFileSync(markdownPath, "# Notes\n\n[TLL-1](tll:1)\n");
  const rules = normalizeLinkPreviewRules([{ match: "^tll:(\\d+)$", resolver: `${fake.origin}/api/{1}` }]);
  const owner = await createTunelitoServer({ filePath: markdownPath, host: "127.0.0.1", port: 0, accessKey: "secret", linkPreviewRules: rules });
  const open = await createTunelitoServer({ filePath: markdownPath, host: "127.0.0.1", port: 0, accessKey: "secret", linkPreviewRules: rules, linkPreviewVisitors: true });
  const none = await createTunelitoServer({ filePath: markdownPath, host: "127.0.0.1", port: 0, accessKey: "secret" });
  const keyed = { cookie: "tunelito_key=secret" };
  const preview = { ...keyed, "x-tunelito-link-preview": "1" };
  const forwarded = { "x-forwarded-for": "203.0.113.10", "cf-connecting-ip": "203.0.113.10" };
  const route = `${LINK_PREVIEW_ROUTE}?href=${encodeURIComponent("tll:1")}`;
  try {
    assert.equal((await get(owner, route, { "x-tunelito-link-preview": "1" })).status, 401, "the review key is required");
    const ok = await get(owner, route, { ...preview, "sec-fetch-site": "same-origin" });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { title: "Fix login", status: "todo", priority: "high" });
    assert.match(ok.headers["content-type"], /^application\/json/);
    assert.equal(ok.headers["x-content-type-options"], "nosniff");

    assert.equal((await get(owner, route, keyed)).status, 403, "the custom request header is required");
    assert.equal((await get(owner, route, { ...preview, "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await get(owner, route, { ...preview, origin: "http://evil.test" })).status, 403);
    assert.equal((await get(owner, route, { ...preview, ...forwarded })).status, 403, "tunnel visitors are refused by default");
    assert.equal((await get(owner, route, { ...preview, host: "evil.test" })).status, 403, "non-loopback Host headers are visitors");
    assert.equal((await get(owner, route, preview, "HEAD")).status, 405);
    assert.equal((await get(owner, `${LINK_PREVIEW_ROUTE}?href=nope`, preview)).status, 404);

    assert.equal((await get(open, route, { ...preview, ...forwarded })).status, 200, "--link-preview-visitors opts visitors in");
    assert.equal((await get(none, route, preview)).status, 404, "no rules means no route");

    assert.match((await get(owner, "/", keyed)).body, /data-tunelito-link-previews="on"/);
    assert.doesNotMatch((await get(owner, "/", { ...keyed, ...forwarded })).body, /data-tunelito-link-previews/);
    assert.match((await get(open, "/", { ...keyed, ...forwarded })).body, /data-tunelito-link-previews="on"/);
    assert.doesNotMatch((await get(none, "/", keyed)).body, /data-tunelito-link-previews/);
  } finally {
    await owner.close();
    await open.close();
    await none.close();
    await fake.close();
  }
});

test("address policy: loopback-only for loopback rules, public-only for remote rules", () => {
  for (const address of ["127.0.0.1", "127.8.9.10", "::1", "[::1]", "::ffff:127.0.0.1"]) {
    assert.equal(isAllowedResolverAddress(address, { loopbackOnly: true }), true, address);
  }
  for (const address of ["10.0.0.5", "8.8.8.8", "0.0.0.0", "::", "fe80::1", "localhost", ""]) {
    assert.equal(isAllowedResolverAddress(address, { loopbackOnly: true }), false, address);
  }
  for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700::1111"]) {
    assert.equal(isAllowedResolverAddress(address, { loopbackOnly: false }), true, address);
  }
  for (const address of [
    "127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "100.100.100.200", "169.254.169.254",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "::", "fc00::1", "fd00:ec2::254", "fe80::1", "ff02::1",
    "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:8.8.8.8",
    "::ffff:0:7f00:1", "64:ff9b::a00:1", "2002:a00:1::1", "192.88.99.1", "not-an-ip",
  ]) {
    assert.equal(isAllowedResolverAddress(address, { loopbackOnly: false }), false, `${address} must be refused in remote mode`);
  }
});

test("resolvePinnedAddresses validates every DNS answer and returns only checked addresses", async () => {
  const answers = (...addresses) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  assert.deepEqual(await resolvePinnedAddresses("localhost", { loopbackOnly: true, resolveHost: answers("::1", "127.0.0.1") }), [
    { address: "::1", family: 6 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await assert.rejects(resolvePinnedAddresses("localhost", { loopbackOnly: true, resolveHost: answers("192.168.1.20") }), /disallowed address/, "a localhost overridden to a LAN address is refused");
  await assert.rejects(resolvePinnedAddresses("tracker.example.com", { loopbackOnly: false, resolveHost: answers("93.184.216.34", "10.0.0.1") }), /disallowed address/, "a mixed public and private answer fails closed");
  await assert.rejects(resolvePinnedAddresses("tracker.example.com", { loopbackOnly: false, resolveHost: answers("::ffff:169.254.169.254") }), /disallowed address/, "IPv4-mapped metadata is refused");
  await assert.rejects(resolvePinnedAddresses("tracker.example.com", { loopbackOnly: false, resolveHost: answers() }), /did not resolve/);
  let lookups = 0;
  assert.deepEqual(await resolvePinnedAddresses("127.0.0.1", { loopbackOnly: true, resolveHost: () => { lookups += 1; return []; } }), [{ address: "127.0.0.1", family: 4 }]);
  assert.equal(lookups, 0, "IP literals skip DNS but still pass the policy");
  const stalled = new AbortController();
  const pending = resolvePinnedAddresses("slow.example.com", { loopbackOnly: false, resolveHost: () => new Promise(() => {}), signal: stalled.signal });
  stalled.abort(new Error("timed out"));
  await assert.rejects(pending, /timed out/, "a stalled DNS lookup honors the fetch timeout");
});

test("loopback resolver fetches connect to the pinned answer and refuse a rebind", async () => {
  const hits = [];
  const fake = await startFakeResolver((req, res) => {
    hits.push({ url: req.url, host: req.headers.host });
    sendJson(res, { title: `issue ${req.url.split("/").pop()}` });
  });
  const port = new URL(fake.origin).port;
  try {
    const plan = [["127.0.0.1"], ["10.0.0.5"], ["::1", "127.0.0.1"]];
    const lookedUp = [];
    const resolveHost = async (hostname) => {
      lookedUp.push(hostname);
      return plan.shift().map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    };
    const rules = normalizeLinkPreviewRules([{ match: "^tll:(\\d+)$", resolver: `http://localhost:${port}/api/{1}` }]);
    const resolver = createLinkPreviewResolver({ rules, resolveHost });
    assert.deepEqual(await resolver.resolve("tll:1"), { status: 200, body: { title: "issue 1" } });
    assert.equal((await resolver.resolve("tll:2")).status, 502, "localhost rebinding to a LAN address fails closed");
    assert.equal((await resolver.resolve("tll:3")).status, 200, "a dual-stack answer still reaches an IPv4-only tracker");
    assert.deepEqual(lookedUp, ["localhost", "localhost", "localhost"], "the host is resolved exactly once per fetch");
    assert.deepEqual(hits, [
      { url: "/api/1", host: `localhost:${port}` },
      { url: "/api/3", host: `localhost:${port}` },
    ], "the rebound fetch never connects, and Host keeps the configured hostname");

    // The system resolver (no network: localhost comes from the hosts file) often
    // answers ::1 first; the IPv4-only fake tracker must still be reached.
    const system = createLinkPreviewResolver({ rules });
    assert.deepEqual(await system.resolve("tll:4"), { status: 200, body: { title: "issue 4" } });
  } finally {
    await fake.close();
  }
});

test("remote resolver fetches pin the validated address with SNI and certificate checks intact", async () => {
  const calls = [];
  const requestImpl = (url, options, onResponse) => {
    calls.push({ url: String(url), options });
    const req = new EventEmitter();
    req.end = () => {
      const res = Readable.from([Buffer.from(JSON.stringify({ title: "Remote issue" }))]);
      res.statusCode = 200;
      res.rawHeaders = ["Content-Type", "application/json"];
      queueMicrotask(() => onResponse(res));
    };
    return req;
  };
  const answersFor = new Map([
    ["mixed.example.com", ["93.184.216.34", "10.0.0.1"]],
    ["mapped.example.com", ["::ffff:10.0.0.1"]],
    ["loopback.example.com", ["127.0.0.1"]],
    ["tracker.example.com", ["93.184.216.34", "2606:2800:220:1::1"]],
  ]);
  const resolveHost = async (hostname) => answersFor.get(hostname).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  const rules = enforceLinkPreviewHostPolicy(normalizeLinkPreviewRules(
    [...answersFor.keys()].map((host) => ({ match: `^${host.split(".")[0]}:(\\d+)$`, resolver: `https://${host}/api/{1}` })),
  ), { allowRemote: true });
  const resolver = createLinkPreviewResolver({ rules, allowRemote: true, fetchImpl: createPinnedFetch({ resolveHost, requestImpl }) });

  assert.equal((await resolver.resolve("mixed:1")).status, 502, "one private answer poisons the whole lookup");
  assert.equal((await resolver.resolve("mapped:1")).status, 502, "IPv4-mapped private answers are refused");
  assert.equal((await resolver.resolve("loopback:1")).status, 502, "a public hostname cannot resolve to loopback");
  assert.equal(calls.length, 0, "no connection is attempted for a refused answer");

  assert.deepEqual(await resolver.resolve("tracker:7"), { status: 200, body: { title: "Remote issue" } });
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(url, "https://tracker.example.com/api/7");
  assert.equal(options.servername, "tracker.example.com", "TLS SNI keeps the configured hostname");
  assert.equal(options.agent, false, "sockets are never pooled across pinned addresses");
  assert.equal("rejectUnauthorized" in options, false, "certificate validation stays on");
  assert.equal(options.headers.accept, "application/json");
  assert.equal(options.autoSelectFamily, true, "Happy Eyeballs runs over the checked list only");
  await new Promise((resolve) => options.lookup("rebound.example.com", { all: true }, (error, list) => {
    assert.deepEqual(list, [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }]);
    resolve();
  }));
  await new Promise((resolve) => options.lookup("rebound.example.com", {}, (error, address, family) => {
    assert.deepEqual([address, family], ["93.184.216.34", 4], "the socket lookup ignores DNS and returns the pinned address");
    resolve();
  }));
});

test("bounded matcher keeps captures and stops catastrophic patterns", () => {
  const matcher = createBoundedMatcher(["^ref:(?<team>[A-Z]+)-(\\d+)(x)?$", "^(a+)+$"], { timeoutMs: 25 });
  const ref = matcher.match(0, "ref:TLL-563");
  assert.deepEqual([...ref], ["ref:TLL-563", "TLL", "563", undefined], "unmatched optional groups stay undefined");
  assert.deepEqual(ref.groups, { team: "TLL" });
  assert.equal(matcher.match(1, "ref:TLL-563"), null);
  const started = Date.now();
  assert.equal(matcher.match(1, `${"a".repeat(40)}b`), MATCH_TIMED_OUT, "a timeout is reported instead of blocking");
  assert.ok(Date.now() - started < 1000, "the timeout fires promptly");
  assert.deepEqual([...matcher.match(1, "aaa")], ["aaa", "aaa"], "the matcher keeps working after a timeout");
});

test("an earlier matching rule still wins over a later catastrophic rule", async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return new Response(JSON.stringify({ title: "first rule" }), { headers: { "content-type": "application/json" } });
  };
  const warnings = [];
  const rules = normalizeLinkPreviewRules([
    { match: "^(a+)b$", resolver: "http://127.0.0.1:9/first/{1}" },
    { match: "^(a+)+$", resolver: "http://127.0.0.1:9/evil/{1}" },
  ]);
  const resolver = createLinkPreviewResolver({ rules, fetchImpl, warn: (line) => warnings.push(line) });
  assert.deepEqual(await resolver.resolve(`${"a".repeat(40)}b`), { status: 200, body: { title: "first rule" } });
  assert.equal(warnings.length, 0, "the catastrophic rule never ran");
  assert.equal((await resolver.resolve(`${"a".repeat(40)}c`)).status, 404, "a timeout in a later rule fails closed");
  assert.match(warnings[0], /^Link preview: linkPreviews\[1\]\.match took longer than 25ms/, "the warning names the rule");
  assert.equal(fetched.length, 1);
});

test("a catastrophic match pattern fails closed without stalling the server", async () => {
  const fake = await startFakeResolver((req, res) => sendJson(res, { title: "matched" }));
  const dir = mkdtempSync(join(tmpdir(), "tunelito-link-preview-redos-"));
  const markdownPath = join(dir, "notes.md");
  writeFileSync(markdownPath, "# Notes\n");
  const warnings = [];
  let clock = 0;
  const rules = normalizeLinkPreviewRules([{ match: "^(a+)+$", resolver: `${fake.origin}/api/{1}` }]);
  const linkPreviewResolver = createLinkPreviewResolver({ rules, warn: (line) => warnings.push(line), now: () => clock });
  const server = await createTunelitoServer({ filePath: markdownPath, host: "127.0.0.1", port: 0, accessKey: "secret", linkPreviewResolver });
  const preview = { cookie: "tunelito_key=secret", "x-tunelito-link-preview": "1" };
  const evil = (n) => `${LINK_PREVIEW_ROUTE}?href=${encodeURIComponent(`${"a".repeat(n)}b`)}`;
  try {
    const started = Date.now();
    const [stalled, page] = await Promise.all([get(server, evil(2000), preview), get(server, "/", { cookie: "tunelito_key=secret" })]);
    assert.equal(stalled.status, 404, "a timed-out match means no preview");
    assert.equal(page.status, 200, "other requests are still served");
    assert.ok(Date.now() - started < 2000, "the catastrophic href returns quickly");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^Link preview: linkPreviews\[0\]\.match took longer than 25ms/);
    assert.doesNotMatch(warnings[0], /aaaa/, "the visitor-controlled href is never logged");

    assert.equal((await get(server, evil(2000), preview)).status, 404, "the same href is not re-run during the failure TTL");
    assert.equal((await get(server, evil(1999), preview)).status, 404);
    assert.equal(warnings.length, 1, "warnings are rate-limited");
    clock += 61_000;
    assert.equal((await get(server, evil(1998), preview)).status, 404);
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /\(1 more since the last warning\)/);
    const benign = await get(server, `${LINK_PREVIEW_ROUTE}?href=aaaa`, preview);
    assert.equal(benign.status, 200, "benign hrefs still match and resolve");
    assert.deepEqual(JSON.parse(benign.body), { title: "matched" });
  } finally {
    await server.close();
    await fake.close();
  }
});

test("match patterns are validated at config load", () => {
  assert.throws(() => normalizeLinkPreviewRules([{ match: "a".repeat(501), resolver: "http://localhost/" }]), /longer than 500 characters/);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "(?<x>a", resolver: "http://localhost/" }]), /not a valid regular expression/);
});

async function startFakeResolver(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}

function sendJson(res, payload, contentType = "application/json") {
  send(res, 200, JSON.stringify(payload), contentType);
}

function send(res, status, body, contentType, headers = {}) {
  res.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function get(instance, path, headers = {}, method = "GET") {
  const url = new URL(path, instance.localUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
