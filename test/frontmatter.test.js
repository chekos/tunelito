import test from "node:test";
import assert from "node:assert/strict";
import {
  FRONT_MATTER_MAX_BYTES,
  extractFrontMatter,
  propertyDisplay,
} from "../src/frontmatter.js";

test("extractFrontMatter recognizes a BOM and preserves YAML key order and Markdown body", () => {
  const source = [
    "\uFEFF---",
    "status: active",
    "project: 'Tunelito'",
    "published: true",
    "priority: 3",
    "updated: 2026-07-16",
    "tags: [markdown, review]",
    "aliases:",
    "  - Review notes",
    "owner:",
    "  name: Chekos",
    "  team: Product",
    "---",
    "",
    "# Review notes",
  ].join("\n");

  const result = extractFrontMatter(source);

  assert.equal(result.kind, "data");
  assert.deepEqual(result.properties.map(({ key }) => key), [
    "status", "project", "published", "priority", "updated", "tags", "aliases", "owner",
  ]);
  assert.equal(result.body, "# Review notes");
  assert.deepEqual(propertyDisplay(result.properties[5].value), { kind: "pills", values: ["markdown", "review"] });
  assert.match(propertyDisplay(result.properties[7].value).text, /"name": "Chekos"/);
});

test("extractFrontMatter returns an accessible-display error payload for invalid YAML", () => {
  const result = extractFrontMatter("---\nstatus: [unfinished\n---\n\n# Still readable");

  assert.equal(result.kind, "error");
  assert.equal(result.body, "# Still readable");
  assert.match(result.originalSource, /status: \[unfinished/);
  assert.ok(result.error.length > 0);
});

test("extractFrontMatter bounds size and nesting without hiding the article", () => {
  const oversized = extractFrontMatter(`---\nvalue: ${"x".repeat(FRONT_MATTER_MAX_BYTES + 1)}\n---\n# Body`);
  assert.equal(oversized.kind, "error");
  assert.equal(oversized.body, "# Body");
  assert.match(oversized.error, /safety limit/);

  const nested = extractFrontMatter("---\na:\n  b:\n    c: value\n---\n# Body", { maxDepth: 2 });
  assert.equal(nested.kind, "error");
  assert.match(nested.error, /nesting depth/);
});

test("extractFrontMatter bounds YAML alias expansion", () => {
  const aliases = Array.from({ length: 30 }, (_, index) => `  key${index}: *base`).join("\n");
  const result = extractFrontMatter(`---\nbase: &base {nested: value}\nrefs:\n${aliases}\n---\n# Body`);

  assert.equal(result.kind, "error");
  assert.equal(result.body, "# Body");
  assert.match(result.error, /alias count|resource exhaustion/i);
});

test("extractFrontMatter leaves incomplete or non-leading delimiters in Markdown", () => {
  const incomplete = "---\nstatus: active\n# No closing delimiter";
  assert.deepEqual(extractFrontMatter(incomplete), { kind: "none", body: incomplete, properties: [] });

  const nonLeading = "Intro\n\n---\nstatus: active\n---";
  assert.deepEqual(extractFrontMatter(nonLeading), { kind: "none", body: nonLeading, properties: [] });
});

test("propertyDisplay formats empty values and complex arrays without object coercion", () => {
  assert.deepEqual(propertyDisplay(null), { kind: "scalar", text: "—" });
  assert.deepEqual(propertyDisplay(["a", { nested: true }]), {
    kind: "complex",
    text: '[\n  "a",\n  {\n    "nested": true\n  }\n]',
  });
});
