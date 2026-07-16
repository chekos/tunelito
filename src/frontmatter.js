import { parseDocument } from "yaml";

export const FRONT_MATTER_MAX_BYTES = 64 * 1024;
export const FRONT_MATTER_MAX_DEPTH = 8;
export const FRONT_MATTER_MAX_ALIASES = 24;

const OPENING_DELIMITER = /^---[\t ]*\r?\n/;
const CLOSING_DELIMITER = /^---[\t ]*(?:\r?\n|$)/m;

export function extractFrontMatter(markdownSource, {
  maxBytes = FRONT_MATTER_MAX_BYTES,
  maxDepth = FRONT_MATTER_MAX_DEPTH,
} = {}) {
  const source = String(markdownSource || "").replace(/^\uFEFF/, "");
  const opening = OPENING_DELIMITER.exec(source);
  if (!opening) return { kind: "none", body: source, properties: [] };

  const afterOpening = source.slice(opening[0].length);
  const closing = CLOSING_DELIMITER.exec(afterOpening);
  if (!closing) return { kind: "none", body: source, properties: [] };

  const yamlSource = afterOpening.slice(0, closing.index);
  const consumedLength = opening[0].length + closing.index + closing[0].length;
  const originalSource = source.slice(0, consumedLength).replace(/\r?\n$/, "");
  const body = source.slice(consumedLength).replace(/^\r?\n/, "");

  if (Buffer.byteLength(yamlSource, "utf8") > maxBytes) {
    return frontMatterError({
      body,
      originalSource,
      message: `Front matter exceeds the ${formatByteLimit(maxBytes)} safety limit.`,
    });
  }

  try {
    const document = parseDocument(yamlSource, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length) throw document.errors[0];

    const value = document.toJS({
      mapAsMap: true,
      maxAliasCount: FRONT_MATTER_MAX_ALIASES,
    });
    if (!(value instanceof Map)) {
      throw new Error("Front matter must contain a YAML mapping of property names to values.");
    }
    assertBoundedDepth(value, maxDepth);

    return {
      kind: "data",
      body,
      originalSource,
      properties: Array.from(value.entries(), ([key, propertyValue]) => ({
        key: formatKey(key),
        value: propertyValue,
      })),
    };
  } catch (error) {
    return frontMatterError({
      body,
      originalSource,
      message: cleanYamlError(error),
    });
  }
}

export function propertyDisplay(value) {
  if (Array.isArray(value) && value.length > 0 && value.length <= 12 && value.every(isScalar)) {
    return { kind: "pills", values: value.map(formatScalar) };
  }
  if (isScalar(value)) return { kind: "scalar", text: formatScalar(value) };
  return { kind: "complex", text: stringifyComplex(value) };
}

function frontMatterError({ body, originalSource, message }) {
  return {
    kind: "error",
    body,
    originalSource,
    properties: [],
    error: message || "Front matter could not be parsed.",
  };
}

function assertBoundedDepth(value, maxDepth, depth = 0, seen = new Set()) {
  if (isScalar(value)) return;
  if (depth >= maxDepth) {
    throw new Error(`Front matter exceeds the maximum nesting depth of ${maxDepth}.`);
  }
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Map) {
    for (const [key, nestedValue] of value) {
      assertBoundedDepth(key, maxDepth, depth + 1, seen);
      assertBoundedDepth(nestedValue, maxDepth, depth + 1, seen);
    }
    return;
  }
  if (Array.isArray(value) || value instanceof Set) {
    for (const nestedValue of value) assertBoundedDepth(nestedValue, maxDepth, depth + 1, seen);
    return;
  }
  if (typeof value === "object") {
    for (const nestedValue of Object.values(value)) assertBoundedDepth(nestedValue, maxDepth, depth + 1, seen);
  }
}

function isScalar(value) {
  return value === null || value === undefined || ["string", "number", "boolean", "bigint"].includes(typeof value) || value instanceof Date;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString().replace(/T00:00:00\.000Z$/, "");
  return String(value);
}

function formatKey(value) {
  if (isScalar(value)) return formatScalar(value);
  return stringifyComplex(value);
}

function stringifyComplex(value) {
  const plain = toPlainValue(value);
  try {
    return JSON.stringify(plain, null, 2) || String(plain);
  } catch {
    return String(plain);
  }
}

function toPlainValue(value, seen = new Set()) {
  if (isScalar(value)) return value instanceof Date ? formatScalar(value) : value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value.entries(), ([key, nestedValue]) => [formatKey(key), toPlainValue(nestedValue, seen)]));
  }
  if (value instanceof Set) return Array.from(value, (nestedValue) => toPlainValue(nestedValue, seen));
  if (Array.isArray(value)) return value.map((nestedValue) => toPlainValue(nestedValue, seen));
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, toPlainValue(nestedValue, seen)]));
}

function cleanYamlError(error) {
  const firstLine = String(error?.message || error || "Front matter could not be parsed.").split("\n", 1)[0].trim();
  return firstLine.slice(0, 320) || "Front matter could not be parsed.";
}

function formatByteLimit(bytes) {
  return bytes >= 1024 ? `${Math.floor(bytes / 1024)} KB` : `${bytes} byte`;
}
