import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildManifest,
  computeDigest,
  manifestJson,
  manifestPath,
  parseSkillFrontmatter,
  skillPath,
} from "../scripts/build-skill-manifest.mjs";

test("distributable skill carries the required SKILL.md frontmatter", () => {
  const fields = parseSkillFrontmatter(readFileSync(skillPath, "utf8"));
  assert.equal(fields.name, "tunelito");
  for (const field of ["description", "license", "compatibility"]) {
    assert.ok(fields[field] && fields[field].length > 0, `missing frontmatter field: ${field}`);
  }
  // The skill listing truncates description; keep it within the documented API cap.
  assert.ok(fields.description.length <= 1024, `description is ${fields.description.length} chars (max 1024)`);
});

test("committed agent-skills manifest is in sync with the skill", () => {
  const committed = readFileSync(manifestPath, "utf8");
  assert.equal(committed, manifestJson(), "run `npm run skill:manifest` to regenerate the manifest");
});

test("manifest entry matches the skill name, type, and content digest", () => {
  const entry = buildManifest().skills[0];
  assert.equal(entry.name, "tunelito");
  assert.equal(entry.type, "skill-md");
  assert.equal(entry.digest, computeDigest(readFileSync(skillPath, "utf8")));
  assert.match(entry.url, /^https:\/\/raw\.githubusercontent\.com\/chekos\/tunelito\//);
});
