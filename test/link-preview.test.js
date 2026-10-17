import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LINK_PREVIEW_ROUTE,
  buildResolverUrl,
  createLinkPreviewResolver,
  enforceLinkPreviewHeaderPolicy,
  enforceLinkPreviewHostPolicy,
  extractLinkPreviewFields,
  normalizeLinkPreviewRules,
  parseLinkPreviewFieldsArg,
} from "../src/link-preview.js";
import { parseLinkPreviewHeaderArg, resolveLinkPreviewHeaders } from "../src/link-preview-headers.js";
import { resolveTunelitoConfig } from "../src/config.js";
import { createTunelitoServer } from "../src/server.js";
import { linkPreviewStartupLines, parseArgs, runConfigCommand } from "../bin/tunelito.js";

const SECRET = "tok_SuperSecret_9f8e7d";

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

test("resolver headers validate names and values and reject literal secrets without echoing them", () => {
  const rule = (headers, resolver = "http://127.0.0.1:3100/a") => normalizeLinkPreviewRules([{ match: "a", resolver, headers }]);
  const [ok] = rule({ Authorization: "Bearer ${env:TRACKER_TOKEN}", "X-Api-Version": "2", Cookie: "${env:TRACKER_COOKIE}" });
  assert.deepEqual(ok.headers.map(({ name, env }) => [name, env]), [
    ["Authorization", ["TRACKER_TOKEN"]], ["X-Api-Version", []], ["Cookie", ["TRACKER_COOKIE"]],
  ]);
  assert.deepEqual(rule(undefined)[0].headers, []);

  const literal = [
    { Authorization: `Bearer ${SECRET}` },
    { Authorization: `Bearer ${SECRET}\${env:TRACKER_TOKEN}` },
    { "X-Api-Key": SECRET },
    { "Private-Token": SECRET },
    { Cookie: `session=${SECRET}` },
  ];
  for (const headers of literal) {
    assert.throws(() => rule(headers), (error) => /literal secrets are not allowed/.test(error.message) && !error.message.includes(SECRET));
  }
  for (const value of ["a\r\nX-Injected: 1", "a\nb", "a\u0000b"]) {
    assert.throws(() => rule({ "X-Api-Version": value }), /line break, control character/);
  }
  assert.throws(() => rule({ "X-Bad\r\nName": "1" }), /invalid header name/);
  for (const name of ["Host", "connection", "Transfer-Encoding", "Upgrade", "TE", "Content-Length", "Accept", "Proxy-Authorization", "X-Forwarded-For", "X-Tunelito-Link-Preview"]) {
    assert.throws(() => rule({ [name]: "x" }), /cannot be set/, `${name} must be blocked`);
  }
  assert.throws(() => rule({ "X-A": "1", "x-a": "2" }), /more than once/);
  assert.throws(() => rule({ Authorization: "Bearer ${TRACKER_TOKEN}" }), /malformed placeholder/);
  assert.throws(() => rule({ "X-A": "${env:1BAD}" }), /malformed placeholder/);
  assert.throws(() => rule({ "X-A": "" }), /non-empty string/);
  assert.throws(() => rule(["Authorization"]), /must map header names/);
  assert.throws(() => rule(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`X-H${i}`, "1"]))), /at most 8 headers/);

  assert.deepEqual(parseLinkPreviewHeaderArg("Authorization: Bearer ${env:T}"), ["Authorization", "Bearer ${env:T}"]);
  assert.throws(() => parseLinkPreviewHeaderArg(SECRET), (error) => /'Name: value'/.test(error.message) && !error.message.includes(SECRET));
});

test("resolver headers need a CLI env allowlist and an https or loopback resolver", () => {
  const [local] = normalizeLinkPreviewRules([{ match: "a", resolver: "http://127.0.0.1:3100/a", headers: { Authorization: "Bearer ${env:TRACKER_TOKEN}" } }]);
  assert.throws(() => enforceLinkPreviewHeaderPolicy([local]), /resolver headers are off; pass --link-preview-env/);
  assert.throws(() => enforceLinkPreviewHeaderPolicy([local], { allowedEnv: ["OTHER"] }), /pass --link-preview-env TRACKER_TOKEN/);
  assert.equal(enforceLinkPreviewHeaderPolicy([local], { allowedEnv: ["TRACKER_TOKEN"] }).length, 1);
  assert.throws(() => createLinkPreviewResolver({ rules: [local] }), /resolver headers are off/, "the library enforces the header policy too");

  const [plainRemote] = normalizeLinkPreviewRules([{ match: "a", resolver: "http://tracker.example.com/a", headers: { Authorization: "${env:T}" } }]);
  assert.throws(() => enforceLinkPreviewHeaderPolicy([plainRemote], { allowedEnv: ["T"] }), /https:\/\/ resolver or a loopback/);
  const [remote] = normalizeLinkPreviewRules([{ match: "a", resolver: "https://tracker.example.com/a", headers: { Authorization: "${env:T}" } }]);
  assert.equal(enforceLinkPreviewHeaderPolicy([remote], { allowedEnv: ["T"] }).length, 1);
  assert.throws(() => createLinkPreviewResolver({ rules: [remote], allowedEnv: ["T"], env: { T: "x" } }), /not loopback/, "headers do not bypass the remote opt-in");
  assert.equal(createLinkPreviewResolver({ rules: [remote], allowRemote: true, allowedEnv: ["T"], env: { T: "x" } }).enabled, true);

  const warnings = [];
  const headers = local.headers;
  assert.deepEqual(resolveLinkPreviewHeaders(headers, { env: { TRACKER_TOKEN: SECRET } }), { authorization: `Bearer ${SECRET}` });
  assert.equal(resolveLinkPreviewHeaders(headers, { env: {}, warn: (...args) => warnings.push(args) }), null);
  assert.equal(resolveLinkPreviewHeaders(headers, { env: { TRACKER_TOKEN: "" }, warn: (...args) => warnings.push(args) }), null);
  assert.equal(resolveLinkPreviewHeaders(headers, { env: { TRACKER_TOKEN: "a\r\nX-Injected: 1" }, warn: (...args) => warnings.push(args) }), null);
  assert.deepEqual(warnings, [["TRACKER_TOKEN", "unset"], ["TRACKER_TOKEN", "unset"], ["TRACKER_TOKEN", "unsafe"]]);
});

test("parseArgs attaches --link-preview-header to the preceding rule and collects --link-preview-env", () => {
  const opts = parseArgs([
    "notes.md",
    "--link-preview", "^a$", "http://127.0.0.1:1/a",
    "--link-preview-header", "Authorization: Bearer ${env:TRACKER_TOKEN}",
    "--link-preview-header", "X-Api-Version: 2",
    "--link-preview-env", "TRACKER_TOKEN",
    "--link-preview-env", "TRACKER_TOKEN",
  ]);
  assert.deepEqual(opts.linkPreviews, [{ match: "^a$", resolver: "http://127.0.0.1:1/a", headers: { Authorization: "Bearer ${env:TRACKER_TOKEN}", "X-Api-Version": "2" } }]);
  assert.deepEqual(opts.linkPreviewAllowedEnv, ["TRACKER_TOKEN"]);
  assert.throws(() => parseArgs(["notes.md", "--link-preview-header", "X-A: 1"]), /must follow the --link-preview rule/);
  assert.throws(() => parseArgs(["notes.md", "--link-preview", "a", "http://127.0.0.1/", "--link-preview-header", "X-A: 1", "--link-preview-header", "x-a: 2"]), /given twice/);
  assert.throws(() => parseArgs(["notes.md", "--link-preview-env", "BAD-NAME"]), /environment variable name/);
  assert.throws(() => parseArgs(["notes.md", "--link-preview", "a", "http://127.0.0.1/", "--link-preview-header", "nocolon"]), /'Name: value'/);
});

test("resolver sends env-sourced headers only to the owner's credentialed rule and never echoes them", async () => {
  const seen = [];
  const fake = await startFakeResolver((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization, version: req.headers["x-api-version"] });
    if (req.url.endsWith("/redirect")) return send(res, 302, "", "application/json", { location: "http://127.0.0.1:1/ok" });
    if (req.url.endsWith("/fail")) return send(res, 500, `bad ${req.headers.authorization}`, "text/plain");
    sendJson(res, { title: req.headers.authorization ? "Private issue" : "Public issue" });
  });
  const config = [
    { match: "^tll:(\\w+)$", resolver: `${fake.origin}/api/{1}`, headers: { Authorization: "Bearer ${env:TRACKER_TOKEN}", "X-Api-Version": "2" } },
    { match: "^tll:(\\w+)$", resolver: `${fake.origin}/api/{1}` },
  ];
  const rules = normalizeLinkPreviewRules(config);
  const warnings = [];
  try {
    const resolver = createLinkPreviewResolver({ rules, allowedEnv: ["TRACKER_TOKEN"], env: { TRACKER_TOKEN: SECRET }, warn: (message) => warnings.push(message) });
    const owner = await resolver.resolve("tll:ok");
    assert.deepEqual(owner, { status: 200, body: { title: "Private issue" } });
    assert.equal(seen[0].authorization, `Bearer ${SECRET}`);
    assert.equal(seen[0].version, "2");
    assert.deepEqual(await resolver.resolve("tll:ok", { visitor: true }), { status: 200, body: { title: "Public issue" } }, "visitors skip credentialed rules and never read their cache");
    assert.equal(seen[1].authorization, undefined);
    for (const route of ["redirect", "fail"]) {
      const result = await resolver.resolve(`tll:${route}`);
      assert.equal(result.status, 502);
      assert.ok(!JSON.stringify(result).includes(SECRET), `${route} must not echo the header`);
    }
    assert.equal(seen.filter((hit) => hit.url.endsWith("/redirect")).length, 1, "redirects are not followed");
    assert.deepEqual(warnings, []);

    const missing = createLinkPreviewResolver({ rules, allowedEnv: ["TRACKER_TOKEN"], env: {}, warn: (message) => warnings.push(message) });
    const before = seen.length;
    assert.equal((await missing.resolve("tll:other")).status, 502, "a missing env var fails closed");
    assert.equal((await missing.resolve("tll:another")).status, 502);
    assert.equal(seen.length, before, "no unauthenticated request is sent in its place");
    assert.deepEqual(warnings, ["Link previews: environment variable TRACKER_TOKEN is not set or is empty; previews that need it are disabled."], "warned once, at creation");

    warnings.length = 0;
    const injected = createLinkPreviewResolver({ rules, allowedEnv: ["TRACKER_TOKEN"], env: { TRACKER_TOKEN: `${SECRET}\r\nX-Injected: 1` }, warn: (message) => warnings.push(message) });
    assert.equal((await injected.resolve("tll:injected")).status, 502, "an unsafe env value fails closed");
    assert.equal(seen.length, before, "no request is sent with an unsafe value");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /TRACKER_TOKEN contains a line break/);
    assert.ok(!warnings[0].includes(SECRET));
  } finally {
    await fake.close();
  }
});

test("config show, startup output, and errors show header templates but never resolved values", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-link-preview-headers-"));
  const homePath = join(dir, "home");
  writeFileSync(join(dir, "notes.md"), "# Notes\n");
  const rule = { match: "^tll:(\\d+)$", resolver: "https://tracker.example.com/api/{1}", headers: { Authorization: "Bearer ${env:TRACKER_TOKEN}" } };
  const globalDir = join(homePath, ".config", "tunelito");
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(join(globalDir, "config.json"), JSON.stringify({ linkPreviews: [rule] }));
  const env = { TRACKER_TOKEN: SECRET };

  for (const format of [[], ["--json"]]) {
    const stdout = collector();
    const stderr = collector();
    assert.equal(runConfigCommand(["show", join(dir, "notes.md"), ...format], { stdout, stderr, env, homePath }), 0);
    assert.ok(!stdout.text().includes(SECRET) && !stderr.text().includes(SECRET));
    assert.match(stdout.text(), /Bearer \$\{env:TRACKER_TOKEN\}|Authorization from \$\{env:TRACKER_TOKEN\}/);
  }
  const report = JSON.parse((() => {
    const stdout = collector();
    runConfigCommand(["show", join(dir, "notes.md"), "--json"], { stdout, stderr: collector(), env, homePath });
    return stdout.text();
  })());
  assert.deepEqual(report.linkPreviews.rules[0].headers, { Authorization: "Bearer ${env:TRACKER_TOKEN}" });

  const resolved = resolveTunelitoConfig({ targetPath: join(dir, "notes.md"), homePath, env });
  const lines = linkPreviewStartupLines(resolved, {}).join("\n");
  assert.match(lines, /Resolver headers \(owner only\): https:\/\/tracker\.example\.com <- Authorization from \$\{env:TRACKER_TOKEN\}/);
  assert.ok(!lines.includes(SECRET));
  assert.throws(() => enforceLinkPreviewHeaderPolicy(resolved.linkPreviewRules), (error) => /--link-preview-env/.test(error.message) && !error.message.includes(SECRET), "a config file alone cannot enable headers");

  // A cloned project config cannot point an allowlisted variable at its own resolver.
  writeFileSync(join(dir, "tunelito.config.json"), JSON.stringify({ linkPreviews: [{ match: "^x:(\\d+)$", resolver: "https://evil.example/{1}", headers: { "X-Debug": "${env:TRACKER_TOKEN}" } }] }));
  let stderr = collector();
  assert.equal(runConfigCommand(["show", join(dir, "notes.md")], { stdout: collector(), stderr, env, homePath }), 1);
  assert.match(stderr.text(), /Invalid project Tunelito config .*headers are not allowed in a project config/);
  assert.throws(() => resolveTunelitoConfig({ targetPath: join(dir, "notes.md"), homePath, env }), /headers are not allowed in a project config/);

  writeFileSync(join(dir, "tunelito.config.json"), JSON.stringify({ linkPreviews: [{ ...rule, headers: { Authorization: `Bearer ${SECRET}` } }] }));
  stderr = collector();
  assert.equal(runConfigCommand(["show", join(dir, "notes.md")], { stdout: collector(), stderr, env, homePath }), 1);
  assert.match(stderr.text(), /literal secrets are not allowed/);
  assert.ok(!stderr.text().includes(SECRET), "the rejected literal is not echoed");
});

test("resolved header values are single-pass and must be Latin-1", () => {
  const [rule] = normalizeLinkPreviewRules([{ match: "a", resolver: "http://127.0.0.1:3100/a", headers: { Authorization: "Bearer ${env:A}" } }]);
  assert.deepEqual(resolveLinkPreviewHeaders(rule.headers, { env: { A: "${env:B}", B: SECRET } }), { authorization: "Bearer ${env:B}" }, "env values are not re-expanded");
  const warnings = [];
  assert.equal(resolveLinkPreviewHeaders(rule.headers, { env: { A: "tok☃" }, warn: (...args) => warnings.push(args) }), null);
  assert.deepEqual(warnings, [["A", "unsafe"]]);
  assert.throws(() => normalizeLinkPreviewRules([{ match: "a", resolver: "http://127.0.0.1/", headers: { "X-A": "☃" } }]), /non-Latin-1/);
});

test("link-preview route keeps credentialed rules owner-only even with --link-preview-visitors", async () => {
  const seen = [];
  const fake = await startFakeResolver((req, res) => {
    seen.push(req.headers.authorization);
    sendJson(res, { title: "Private issue" });
  });
  const dir = mkdtempSync(join(tmpdir(), "tunelito-link-preview-auth-"));
  const markdownPath = join(dir, "notes.md");
  writeFileSync(markdownPath, "# Notes\n\n[TLL-1](tll:1)\n");
  const rules = normalizeLinkPreviewRules([{ match: "^tll:(\\d+)$", resolver: `${fake.origin}/api/{1}`, headers: { Authorization: "Bearer ${env:TRACKER_TOKEN}" } }]);
  const options = { filePath: markdownPath, host: "127.0.0.1", port: 0, accessKey: "secret", linkPreviewRules: rules, linkPreviewVisitors: true };
  await assert.rejects(createTunelitoServer(options), /resolver headers are off/);
  const instance = await createTunelitoServer({ ...options, linkPreviewAllowedEnv: ["TRACKER_TOKEN"], linkPreviewEnv: { TRACKER_TOKEN: SECRET } });
  const preview = { cookie: "tunelito_key=secret", "x-tunelito-link-preview": "1" };
  const route = `${LINK_PREVIEW_ROUTE}?href=${encodeURIComponent("tll:1")}`;
  try {
    const owner = await get(instance, route, preview);
    assert.equal(owner.status, 200);
    assert.ok(!owner.body.includes(SECRET) && !JSON.stringify(owner.headers).includes(SECRET));
    assert.deepEqual(seen, [`Bearer ${SECRET}`]);
    const visitor = await get(instance, route, { ...preview, "x-forwarded-for": "203.0.113.10" });
    assert.equal(visitor.status, 404, "visitors never borrow the owner's credentials");
    assert.equal(seen.length, 1);
    assert.equal((await get(instance, route, { "x-tunelito-link-preview": "1" })).status, 401, "the review key is still required");
  } finally {
    await instance.close();
    await fake.close();
  }
});

function collector() {
  let text = "";
  return { write(chunk) { text += chunk; }, text: () => text };
}

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
