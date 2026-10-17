// Resolver-backed link previews (#135). The Tunelito server fetches preview JSON on the
// browser's behalf so origin, host, size, and timeout rules stay server-side.

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { Script, createContext } from "node:vm";
import { pinnedLookup } from "./tunnel.js";

export const LINK_PREVIEW_ROUTE = "/__tunelito/link-preview";
export const LINK_PREVIEW_REQUEST_HEADER = "x-tunelito-link-preview";
export const LINK_PREVIEW_FIELDS = ["title", "status", "priority"];
export const DEFAULT_LINK_PREVIEW_FIELDS = Object.freeze({ title: "title", status: "status", priority: "priority" });
export const LINK_PREVIEW_LIMITS = Object.freeze({
  maxRules: 20,
  maxPatternLength: 500,
  maxTemplateLength: 2048,
  maxHrefLength: 2048,
  maxVisitorHrefLength: 512,
  maxFieldLength: 200,
  maxResponseBytes: 64 * 1024,
  timeoutMs: 3000,
  maxConcurrent: 4,
  cacheEntries: 256,
  cacheTtlMs: 60_000,
  failureTtlMs: 15_000,
  matchTimeoutMs: 10,
  matchWarningIntervalMs: 60_000,
});

const RULE_KEYS = new Set(["match", "resolver", "fields"]);
const FIELD_PATH = /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*|\d)\}/g;
const JSON_CONTENT_TYPE = /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i;

export class LinkPreviewConfigError extends Error {}

// Structural validation. Host policy (loopback vs remote) is applied by
// enforceLinkPreviewHostPolicy so `config show` can report remote rules without serving them.
export function normalizeLinkPreviewRules(rules, { label = "linkPreviews" } = {}) {
  if (rules == null) return [];
  if (!Array.isArray(rules)) throw new LinkPreviewConfigError(`${label} must be an array of rules`);
  if (rules.length > LINK_PREVIEW_LIMITS.maxRules) {
    throw new LinkPreviewConfigError(`${label} supports at most ${LINK_PREVIEW_LIMITS.maxRules} rules`);
  }
  return rules.map((rule, index) => normalizeRule(rule, `${label}[${index}]`));
}

function normalizeRule(rule, label) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new LinkPreviewConfigError(`${label} must be an object with "match" and "resolver"`);
  }
  const unknown = Object.keys(rule).filter((key) => !RULE_KEYS.has(key));
  if (unknown.length) throw new LinkPreviewConfigError(`${label} has unknown ${unknown.length === 1 ? "setting" : "settings"} ${unknown.map((key) => `"${key}"`).join(", ")}`);
  if (typeof rule.match !== "string" || !rule.match) throw new LinkPreviewConfigError(`${label}.match must be a non-empty regular expression string`);
  if (rule.match.length > LINK_PREVIEW_LIMITS.maxPatternLength) throw new LinkPreviewConfigError(`${label}.match is longer than ${LINK_PREVIEW_LIMITS.maxPatternLength} characters`);
  let pattern;
  try {
    pattern = new RegExp(rule.match);
  } catch (error) {
    throw new LinkPreviewConfigError(`${label}.match is not a valid regular expression: ${error.message}`);
  }
  if (typeof rule.resolver !== "string" || !rule.resolver) throw new LinkPreviewConfigError(`${label}.resolver must be a URL template string`);
  const resolver = rule.resolver.trim();
  if (resolver.length > LINK_PREVIEW_LIMITS.maxTemplateLength) throw new LinkPreviewConfigError(`${label}.resolver is longer than ${LINK_PREVIEW_LIMITS.maxTemplateLength} characters`);
  const origin = templateOrigin(resolver, label);
  validatePlaceholders(resolver, pattern, label);
  return {
    match: rule.match,
    pattern,
    resolver,
    origin: origin.origin,
    hostname: origin.hostname,
    protocol: origin.protocol,
    fields: normalizeFields(rule.fields, label),
  };
}

function templateOrigin(template, label) {
  // The scheme and authority must be literal so link text can never pick the host.
  const authority = /^(https?):\/\/([^/?#]*)(?=[/?#]|$)/i.exec(template);
  if (!authority) throw new LinkPreviewConfigError(`${label}.resolver must be an absolute http(s) URL template`);
  if (/[{}]/.test(authority[2])) throw new LinkPreviewConfigError(`${label}.resolver cannot use placeholders in the scheme or host`);
  let url;
  try {
    url = new URL(template.replace(PLACEHOLDER, "x"));
  } catch {
    throw new LinkPreviewConfigError(`${label}.resolver is not a valid URL template`);
  }
  if (url.username || url.password) throw new LinkPreviewConfigError(`${label}.resolver must not embed credentials`);
  return { origin: url.origin, hostname: url.hostname, protocol: url.protocol };
}

function validatePlaceholders(template, pattern, label) {
  const probe = new RegExp(`${pattern.source}|`).exec("");
  const groupCount = probe.length - 1;
  const names = new Set(Object.keys(probe.groups || {}));
  for (const [, token] of template.matchAll(PLACEHOLDER)) {
    if (/^\d$/.test(token)) {
      if (Number(token) > groupCount) throw new LinkPreviewConfigError(`${label}.resolver uses {${token}} but match has ${groupCount} capture group${groupCount === 1 ? "" : "s"}`);
    } else if (!names.has(token)) {
      throw new LinkPreviewConfigError(`${label}.resolver uses {${token}} but match has no group named "${token}"`);
    }
  }
}

function normalizeFields(fields, label) {
  if (fields == null) return { ...DEFAULT_LINK_PREVIEW_FIELDS };
  if (typeof fields !== "object" || Array.isArray(fields)) throw new LinkPreviewConfigError(`${label}.fields must map title/status/priority to JSON paths`);
  const unknown = Object.keys(fields).filter((key) => !LINK_PREVIEW_FIELDS.includes(key));
  if (unknown.length) throw new LinkPreviewConfigError(`${label}.fields supports only ${LINK_PREVIEW_FIELDS.join(", ")}; got ${unknown.map((key) => `"${key}"`).join(", ")}`);
  const normalized = {};
  for (const key of LINK_PREVIEW_FIELDS) {
    const path = Object.hasOwn(fields, key) ? fields[key] : DEFAULT_LINK_PREVIEW_FIELDS[key];
    if (typeof path !== "string" || !FIELD_PATH.test(path)) throw new LinkPreviewConfigError(`${label}.fields.${key} must be a dotted JSON path such as "state.name"`);
    normalized[key] = path;
  }
  return normalized;
}

// "title=name,status=state.name" -> { title: "name", status: "state.name" }
export function parseLinkPreviewFieldsArg(value) {
  const fields = {};
  for (const part of String(value || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const [key, path, ...rest] = part.split("=").map((item) => item.trim());
    if (!key || !path || rest.length) throw new LinkPreviewConfigError(`Invalid --link-preview-fields entry "${part}"; use title=path,status=path,priority=path`);
    fields[key] = path;
  }
  if (!Object.keys(fields).length) throw new LinkPreviewConfigError("--link-preview-fields requires at least one field=path mapping");
  return fields;
}

export function enforceLinkPreviewHostPolicy(rules, { allowRemote = false } = {}) {
  for (const [index, rule] of rules.entries()) {
    if (isLoopbackHostname(rule.hostname)) continue;
    if (!allowRemote) {
      throw new LinkPreviewConfigError(`linkPreviews[${index}].resolver host ${rule.hostname} is not loopback; pass --link-preview-allow-remote to fetch from other hosts`);
    }
    if (rule.protocol !== "https:") {
      throw new LinkPreviewConfigError(`linkPreviews[${index}].resolver must use https:// for a non-loopback host`);
    }
    if (isReservedAddressLiteral(rule.hostname)) {
      throw new LinkPreviewConfigError(`linkPreviews[${index}].resolver host ${rule.hostname} is a private, link-local, or unspecified address; remote resolvers must be public hosts`);
    }
  }
  return rules;
}

// Address policy (#142). net.BlockList normalizes IPv6 spellings and checks
// IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 subnets too.
const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_ADDRESSES.addAddress("::1", "ipv6");

const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // unspecified / "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT; also Alibaba metadata 100.100.100.200
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local; cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
]) NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // deprecated IPv4-compatible
  ["64:ff9b::", 96], // NAT64 can reach an embedded private IPv4
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo embeds an IPv4 address
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 embeds an IPv4 address
  ["fc00::", 7], // unique local; includes fd00:ec2::254 metadata
  ["fe80::", 10], // link-local
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
]) NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv6");

// Kept separate and checked only for IPv6 input: BlockList also applies an
// ::ffff:0:0/96 rule to plain IPv4 addresses, which would block everything.
const IPV4_MAPPED_ADDRESSES = new BlockList();
IPV4_MAPPED_ADDRESSES.addSubnet("::ffff:0:0", 96, "ipv6");

function bareHost(value) {
  return String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/**
 * The one address policy for resolver connections. `loopbackOnly` (every
 * loopback-named rule, and every rule without --link-preview-allow-remote)
 * accepts only 127.0.0.0/8 and ::1. Otherwise the address must be public.
 */
export function isAllowedResolverAddress(address, { loopbackOnly }) {
  const value = bareHost(address);
  const family = isIP(value);
  if (!family) return false;
  const type = family === 6 ? "ipv6" : "ipv4";
  if (loopbackOnly) return LOOPBACK_ADDRESSES.check(value, type);
  // IPv4-mapped IPv6 is refused outright in remote mode rather than decoded.
  if (type === "ipv6" && IPV4_MAPPED_ADDRESSES.check(value, type)) return false;
  return !NON_PUBLIC_ADDRESSES.check(value, type);
}

// Literal private/link-local/metadata/unspecified addresses are never valid "remote" resolvers.
// Hostnames are checked after DNS resolution by resolvePinnedAddress.
export function isReservedAddressLiteral(value) {
  const host = bareHost(value);
  if (host.startsWith("::ffff:")) return true; // IPv4-mapped literals: refuse rather than decode.
  return isIP(host) ? !isAllowedResolverAddress(host, { loopbackOnly: false }) : false;
}

export function isLoopbackHostname(value) {
  const host = bareHost(value);
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Resolve a resolver hostname once and return the single address to connect to.
 * Every answer must pass the address policy, so a mixed public/private answer
 * fails closed. IP literals skip DNS but get the same check.
 */
export async function resolvePinnedAddress(hostname, { loopbackOnly, resolveHost = defaultResolveHost, signal } = {}) {
  const host = bareHost(hostname);
  const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(resolveHost(host), signal);
  if (!Array.isArray(answers) || !answers.length) throw new LinkPreviewAddressError(`${host} did not resolve`);
  for (const answer of answers) {
    if (!isAllowedResolverAddress(answer?.address, { loopbackOnly })) {
      throw new LinkPreviewAddressError(`${host} resolved to a disallowed address`);
    }
  }
  return { address: bareHost(answers[0].address), family: isIP(bareHost(answers[0].address)) };
}

export class LinkPreviewAddressError extends Error {}

function defaultResolveHost(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * A fetch-compatible function for resolver requests (#142). It resolves the
 * host once, validates every answer, then connects to that pinned address with
 * a `lookup` override, so Host, TLS SNI, and certificate validation still use
 * the URL hostname and a DNS rebind between check and connect cannot redirect
 * it. It never follows redirects and never pools sockets.
 */
export function createPinnedFetch({ resolveHost = defaultResolveHost, requestImpl } = {}) {
  return async function pinnedFetch(url, { method = "GET", headers = {}, signal } = {}) {
    const target = new URL(url);
    const hostname = bareHost(target.hostname);
    const pinned = await resolvePinnedAddress(hostname, { loopbackOnly: isLoopbackHostname(hostname), resolveHost, signal });
    const send = requestImpl || (target.protocol === "https:" ? httpsRequest : httpRequest);
    return new Promise((resolve, reject) => {
      const req = send(target, {
        method,
        headers,
        signal,
        agent: false,
        lookup: pinnedLookup(pinned.address),
        servername: isIP(hostname) ? undefined : hostname,
      }, (res) => {
        try {
          resolve(toFetchResponse(res));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      });
      req.on("error", reject);
      req.end();
    });
  };
}

function toFetchResponse(res) {
  const headers = new Headers();
  const raw = res.rawHeaders || [];
  for (let index = 0; index + 1 < raw.length; index += 2) headers.append(raw[index], raw[index + 1]);
  const nullBody = [204, 205, 304].includes(res.statusCode) || res.req?.method === "HEAD";
  if (nullBody) res.resume();
  return new Response(nullBody ? null : Readable.toWeb(res), { status: res.statusCode, headers });
}

/**
 * Run every rule's regex against one href inside a vm context with a hard
 * timeout (#143). The patterns are compiled inside the context once; a
 * catastrophic pattern throws ERR_SCRIPT_EXECUTION_TIMEOUT instead of blocking
 * the event loop. Returns one match (or null) per rule, or null on timeout.
 */
export function createBoundedMatcher(sources, { timeoutMs = LINK_PREVIEW_LIMITS.matchTimeoutMs } = {}) {
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  context.sources = Array.from(sources, String);
  new Script(`"use strict";
    const patterns = [];
    for (let index = 0; index < sources.length; index += 1) patterns.push(new RegExp(sources[index]));
    globalThis.matchAll = (href) => {
      const results = [];
      for (let index = 0; index < patterns.length; index += 1) {
        const match = patterns[index].exec(href);
        results.push(match ? { values: Array.from(match), groups: match.groups ? Object.assign({}, match.groups) : undefined } : null);
      }
      return results;
    };`).runInContext(context);
  delete context.sources;
  const run = new Script("matchAll(href)");
  return function matchAll(href) {
    context.href = String(href);
    try {
      const results = run.runInContext(context, { timeout: timeoutMs });
      return Array.from(results, (result) => {
        if (!result) return null;
        const match = Array.from(result.values);
        match.groups = result.groups ? { ...result.groups } : undefined;
        return match;
      });
    } catch (error) {
      if (error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return null;
      throw error;
    } finally {
      context.href = "";
    }
  };
}

// Unbounded convenience for a single trusted href; the resolver itself uses
// createBoundedMatcher and resolverUrlFromMatch.
export function buildResolverUrl(rule, href) {
  return resolverUrlFromMatch(rule, rule.pattern.exec(href));
}

export function resolverUrlFromMatch(rule, match) {
  if (!match) return "";
  const captures = { 0: match[0] };
  for (let index = 1; index < match.length; index += 1) captures[index] = match[index];
  for (const [name, value] of Object.entries(match.groups || {})) captures[name] = value;
  let invalid = false;
  const target = rule.resolver.replace(PLACEHOLDER, (_, token) => {
    const value = captures[token];
    if (typeof value !== "string" || !value || value === "." || value === "..") {
      invalid = true;
      return "";
    }
    return encodeURIComponent(value);
  });
  if (invalid) return "";
  let url;
  try {
    url = new URL(target);
  } catch {
    return "";
  }
  return url.origin === rule.origin ? url.href : "";
}

export function extractLinkPreviewFields(payload, fields) {
  const result = {};
  for (const key of LINK_PREVIEW_FIELDS) {
    const text = cleanPreviewText(readPath(payload, fields[key]));
    if (text) result[key] = text;
  }
  return result.title || result.status || result.priority ? result : null;
}

function readPath(value, path) {
  let current = value;
  for (const segment of String(path || "").split(".")) {
    if (current == null || typeof current !== "object" || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function cleanPreviewText(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LINK_PREVIEW_LIMITS.maxFieldLength);
}

export function createLinkPreviewResolver({
  rules = [],
  allowRemote = false,
  resolveHost,
  // The default fetch pins validated DNS answers (#142). A caller-supplied
  // fetchImpl takes over connection safety itself.
  fetchImpl = createPinnedFetch({ resolveHost }),
  now = () => Date.now(),
  limits = {},
  warn = (message) => console.warn(message),
} = {}) {
  enforceLinkPreviewHostPolicy(rules, { allowRemote });
  const options = { ...LINK_PREVIEW_LIMITS, ...limits };
  const cache = new Map();
  const inflight = new Map();
  const matchAll = createBoundedMatcher(rules.map((rule) => rule.match), { timeoutMs: options.matchTimeoutMs });
  const timedOut = new Map();
  let lastWarningAt = -Infinity;
  let suppressedWarnings = 0;

  // Visitors (only with --link-preview-visitors) get shorter hrefs and cannot take the
  // last upstream slot, so they cannot starve the owner's previews.
  async function resolve(href, { visitor = false } = {}) {
    const value = String(href || "").trim();
    const maxLength = visitor ? options.maxVisitorHrefLength : options.maxHrefLength;
    if (!value || value.length > maxLength) return { status: 404 };
    const match = matchRule(value);
    if (!match) return { status: 404 };
    const cached = cache.get(match.url);
    if (cached && cached.expires > now()) return cached.result;
    if (cached) cache.delete(match.url);
    if (inflight.has(match.url)) return inflight.get(match.url);
    const capacity = visitor ? Math.max(0, options.maxConcurrent - 1) : options.maxConcurrent;
    if (inflight.size >= capacity) return { status: 503 };
    const pending = fetchPreview(match).then((result) => {
      remember(match.url, result);
      return result;
    }).finally(() => inflight.delete(match.url));
    inflight.set(match.url, pending);
    return pending;
  }

  // Fails closed (#143): a match that exceeds matchTimeoutMs yields no preview,
  // and the same href is not retried until the failure TTL passes.
  function matchRule(href) {
    const until = timedOut.get(href);
    if (until > now()) return null;
    if (until) timedOut.delete(href);
    const matches = matchAll(href);
    if (!matches) {
      timedOut.set(href, now() + options.failureTtlMs);
      while (timedOut.size > options.cacheEntries) timedOut.delete(timedOut.keys().next().value);
      warnMatchTimeout();
      return null;
    }
    for (const [index, rule] of rules.entries()) {
      const url = resolverUrlFromMatch(rule, matches[index]);
      if (url) return { rule, url };
    }
    return null;
  }

  // One line per interval; the href is visitor-controlled, so it is never logged.
  function warnMatchTimeout() {
    if (now() - lastWarningAt < options.matchWarningIntervalMs) {
      suppressedWarnings += 1;
      return;
    }
    const suppressed = suppressedWarnings ? ` (${suppressedWarnings} more since the last warning)` : "";
    lastWarningAt = now();
    suppressedWarnings = 0;
    warn(`Link preview: a match pattern took longer than ${options.matchTimeoutMs}ms and was stopped; no preview served${suppressed}. Anchor patterns and avoid nested quantifiers.`);
  }

  async function fetchPreview({ rule, url }) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch {
      return { status: 502 };
    }
    try {
      if (response.status < 200 || response.status >= 300) return { status: 502 };
      if (!JSON_CONTENT_TYPE.test(response.headers.get("content-type") || "")) return { status: 502 };
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > options.maxResponseBytes) return { status: 502 };
      const text = await readBounded(response, options.maxResponseBytes);
      if (text == null) return { status: 502 };
      const preview = extractLinkPreviewFields(JSON.parse(text), rule.fields);
      return preview ? { status: 200, body: preview } : { status: 404 };
    } catch {
      return { status: 502 };
    } finally {
      response.body?.cancel?.().catch(() => {});
    }
  }

  function remember(url, result) {
    if (result.status === 503) return;
    cache.set(url, { result, expires: now() + (result.status === 200 ? options.cacheTtlMs : options.failureTtlMs) });
    while (cache.size > options.cacheEntries) cache.delete(cache.keys().next().value);
  }

  return { enabled: rules.length > 0, resolve, ruleCount: rules.length };
}

async function readBounded(response, maxBytes) {
  if (!response.body?.getReader) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
