// Opt-in request headers for link-preview resolvers (#144). Header values are templates:
// secrets come only from `${env:NAME}` placeholders that are resolved at fetch time, so a
// resolved value never lives in the normalized rule, config reports, logs, or errors.

export const LINK_PREVIEW_HEADER_LIMITS = Object.freeze({
  maxHeaders: 8,
  maxNameLength: 64,
  maxTemplateLength: 1024,
  maxValueLength: 8192,
});

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_PLACEHOLDER = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
// Only tab is allowed among control characters; CR, LF, and NUL would allow header injection.
// Characters above U+00FF are not valid in an HTTP header value (ByteString).
const UNSAFE_VALUE = /[\u0000-\u0008\u000a-\u001f\u007fĀ-￿]/;
// Hop-by-hop, framing, routing, and headers Tunelito itself controls.
const BLOCKED_NAMES = new Set([
  "host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer",
  "upgrade", "content-length", "content-type", "expect", "accept", "accept-encoding", "origin",
  "referer", "forwarded", "via",
]);
const BLOCKED_PREFIXES = ["proxy-", "x-forwarded-", "sec-", "x-tunelito-"];
const CREDENTIAL_NAME = /auth|cookie|token|key|secret|session|passw|credential|signature/i;
// A credential header is `${env:NAME}` or `<Scheme> ${env:NAME}`; no literal secret material.
const CREDENTIAL_TEMPLATE = /^(?:[A-Za-z][A-Za-z0-9._~+-]{0,31} )?\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/;

export class LinkPreviewHeaderError extends Error {}

export function isCredentialHeaderName(name) {
  return CREDENTIAL_NAME.test(String(name || ""));
}

export function isValidEnvName(name) {
  return ENV_NAME.test(String(name || ""));
}

// { "Authorization": "Bearer ${env:TOKEN}" } -> [{ name, template, env: ["TOKEN"] }]
// Errors name the header but never echo its value.
export function normalizeLinkPreviewHeaders(headers, label) {
  if (headers == null) return [];
  if (typeof headers !== "object" || Array.isArray(headers)) {
    throw new LinkPreviewHeaderError(`${label}.headers must map header names to value templates`);
  }
  const entries = Object.entries(headers);
  if (entries.length > LINK_PREVIEW_HEADER_LIMITS.maxHeaders) {
    throw new LinkPreviewHeaderError(`${label}.headers supports at most ${LINK_PREVIEW_HEADER_LIMITS.maxHeaders} headers`);
  }
  const seen = new Set();
  return entries.map(([name, template]) => {
    const where = `${label}.headers[${JSON.stringify(safeName(name))}]`;
    if (!name || name.length > LINK_PREVIEW_HEADER_LIMITS.maxNameLength || !HEADER_NAME.test(name)) {
      throw new LinkPreviewHeaderError(`${label}.headers has an invalid header name; use an HTTP token such as "Authorization"`);
    }
    const lower = name.toLowerCase();
    if (BLOCKED_NAMES.has(lower) || BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      throw new LinkPreviewHeaderError(`${where} cannot be set; hop-by-hop, routing, and Tunelito-controlled headers are blocked`);
    }
    if (seen.has(lower)) throw new LinkPreviewHeaderError(`${where} is given more than once`);
    seen.add(lower);
    if (typeof template !== "string" || !template.trim()) {
      throw new LinkPreviewHeaderError(`${where} must be a non-empty string`);
    }
    if (template.length > LINK_PREVIEW_HEADER_LIMITS.maxTemplateLength) {
      throw new LinkPreviewHeaderError(`${where} is longer than ${LINK_PREVIEW_HEADER_LIMITS.maxTemplateLength} characters`);
    }
    if (UNSAFE_VALUE.test(template)) {
      throw new LinkPreviewHeaderError(`${where} contains a line break, control character, or non-Latin-1 character`);
    }
    if (template.replace(ENV_PLACEHOLDER, "").includes("${")) {
      throw new LinkPreviewHeaderError(`${where} has a malformed placeholder; use \${env:NAME}`);
    }
    if (isCredentialHeaderName(name) && !CREDENTIAL_TEMPLATE.test(template)) {
      throw new LinkPreviewHeaderError(`${where} looks like a credential, so its value must come from an environment variable, such as "Bearer \${env:TRACKER_TOKEN}"; literal secrets are not allowed`);
    }
    const env = [...new Set([...template.matchAll(ENV_PLACEHOLDER)].map((match) => match[1]))];
    return { name, template, env };
  });
}

// "Authorization: Bearer ${env:TOKEN}" -> ["Authorization", "Bearer ${env:TOKEN}"]
export function parseLinkPreviewHeaderArg(value) {
  const text = String(value || "");
  const colon = text.indexOf(":");
  const name = colon > 0 ? text.slice(0, colon).trim() : "";
  const template = colon > 0 ? text.slice(colon + 1).trim() : "";
  if (!name || !template) {
    throw new LinkPreviewHeaderError("Invalid --link-preview-header; use 'Name: value', for example 'Authorization: Bearer ${env:TRACKER_TOKEN}'");
  }
  return [name, template];
}

// Resolves templates against `env` at fetch time. Returns null (fail closed) when a variable
// is unset, empty, or would produce an unsafe header value; `warn` receives the variable name
// and a reason, never the value.
export function resolveLinkPreviewHeaders(headers, { env = process.env, warn = () => {} } = {}) {
  const resolved = {};
  for (const header of headers) {
    let failure = null;
    const value = header.template.replace(ENV_PLACEHOLDER, (_, name) => {
      const raw = Object.hasOwn(env, name) ? env[name] : undefined;
      if (typeof raw !== "string" || !raw) {
        failure ||= { name, reason: "unset" };
        return "";
      }
      if (UNSAFE_VALUE.test(raw)) failure ||= { name, reason: "unsafe" };
      return raw;
    });
    if (!failure && value.length > LINK_PREVIEW_HEADER_LIMITS.maxValueLength) {
      failure = { name: header.env[0] || header.name, reason: "too-long" };
    }
    if (failure) {
      warn(failure.name, failure.reason);
      return null;
    }
    resolved[header.name.toLowerCase()] = value;
  }
  return resolved;
}

export function headerReport(headers) {
  return Object.fromEntries(headers.map(({ name, template }) => [name, template]));
}

function safeName(name) {
  return String(name).replace(/[^!#$%&'*+.^_`|~0-9A-Za-z-]/g, "?").slice(0, LINK_PREVIEW_HEADER_LIMITS.maxNameLength);
}
