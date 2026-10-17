import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LINK_PREVIEW_ROUTE,
  buildResolverUrl,
  createLinkPreviewResolver,
  enforceLinkPreviewHostPolicy,
  extractLinkPreviewFields,
  normalizeLinkPreviewRules,
  parseLinkPreviewFieldsArg,
} from "../src/link-preview.js";
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
    const resolver = createLinkPreviewResolver({ rules, now: () => clock, limits: { timeoutMs: 150 } });

    assert.deepEqual(await resolver.resolve("tll:ok"), { status: 200, body: { title: "Fix login", status: "todo", priority: "high" } });
    assert.deepEqual(await resolver.resolve("tll:ok"), { status: 200, body: { title: "Fix login", status: "todo", priority: "high" } });
    assert.equal(hits.filter((hit) => hit === "/api/ok").length, 1, "fresh results come from the cache");
    clock += 61_000;
    await resolver.resolve("tll:ok");
    assert.equal(hits.filter((hit) => hit === "/api/ok").length, 2, "expired results are refetched");

    assert.equal((await resolver.resolve("tll:vendor")).status, 200, "+json media types are JSON");
    for (const route of ["html", "big", "chunked", "redirect", "missing", "invalid", "slow", "boom"]) {
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
