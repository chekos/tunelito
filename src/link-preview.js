// Resolver-backed link previews (#135). The Tunelito server fetches preview JSON on the
// browser's behalf so origin, host, size, and timeout rules stay server-side.

export const LINK_PREVIEW_ROUTE = "/__tunelito/link-preview";
export const LINK_PREVIEW_REQUEST_HEADER = "x-tunelito-link-preview";
export const LINK_PREVIEW_FIELDS = ["title", "status", "priority"];
export const DEFAULT_LINK_PREVIEW_FIELDS = Object.freeze({ title: "title", status: "status", priority: "priority" });
export const LINK_PREVIEW_LIMITS = Object.freeze({
  maxRules: 20,
  maxPatternLength: 500,
  maxTemplateLength: 2048,
  maxHrefLength: 2048,
  maxFieldLength: 200,
  maxResponseBytes: 64 * 1024,
  timeoutMs: 3000,
  maxConcurrent: 4,
  cacheEntries: 256,
  cacheTtlMs: 60_000,
  failureTtlMs: 15_000,
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
  }
  return rules;
}

export function isLoopbackHostname(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function buildResolverUrl(rule, href) {
  const match = rule.pattern.exec(href);
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
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  limits = {},
} = {}) {
  const options = { ...LINK_PREVIEW_LIMITS, ...limits };
  const cache = new Map();
  const inflight = new Map();

  async function resolve(href) {
    const value = String(href || "").trim();
    if (!value || value.length > options.maxHrefLength) return { status: 404 };
    const match = matchRule(value);
    if (!match) return { status: 404 };
    const cached = cache.get(match.url);
    if (cached && cached.expires > now()) return cached.result;
    if (cached) cache.delete(match.url);
    if (inflight.has(match.url)) return inflight.get(match.url);
    if (inflight.size >= options.maxConcurrent) return { status: 503 };
    const pending = fetchPreview(match).then((result) => {
      remember(match.url, result);
      return result;
    }).finally(() => inflight.delete(match.url));
    inflight.set(match.url, pending);
    return pending;
  }

  function matchRule(href) {
    for (const rule of rules) {
      const url = buildResolverUrl(rule, href);
      if (url) return { rule, url };
    }
    return null;
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
  if (!response.body?.getReader) {
    const text = await response.text();
    return Buffer.byteLength(text) > maxBytes ? null : text;
  }
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
