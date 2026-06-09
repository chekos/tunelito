#!/usr/bin/env node

// Builds the distributable Tunelito agent skill artifacts from docs-site/skill.md
// (the single source of truth). It writes two generated, committed copies:
//
//   - skills/tunelito/SKILL.md
//       The ecosystem-standard location the `skills` CLI discovers, so
//       `npx skills add chekos/tunelito --skill tunelito` installs this skill.
//   - docs-site/.well-known/agent-skills/index.json
//       An RFC 8615 base-URL discovery manifest (the agentskills.io / Cloudflare
//       RFC format) with a sha256 digest of the skill.
//
// docs-site/skill.md stays canonical: it is the Mintlify doc and what
// `tunelito skill show` prints. Both artifacts are derived; `npm run docs:check`
// fails if either drifts, so run `npm run skill:dist` whenever skill.md changes.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const skillPath = join(repoRoot, "docs-site", "skill.md");
export const distSkillPath = join(repoRoot, "skills", "tunelito", "SKILL.md");
export const manifestPath = join(repoRoot, "docs-site", ".well-known", "agent-skills", "index.json");

// Where an agent can fetch the raw skill once it reads the manifest.
const SKILL_URL = "https://raw.githubusercontent.com/chekos/tunelito/main/docs-site/skill.md";

export function readSkill() {
  return readFileSync(skillPath, "utf8");
}

export function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("docs-site/skill.md is missing YAML frontmatter");
  const lines = match[1].split("\n");
  const fields = {};

  for (let i = 0; i < lines.length; i += 1) {
    const keyed = lines[i].match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!keyed) continue;
    const [, key, rawValue] = keyed;
    let value = rawValue;

    // Folded/literal block scalars (">-", ">", "|", "|-") and empty values pull
    // in the indented continuation lines that follow.
    if (["", ">", ">-", "|", "|-"].includes(value.trim())) {
      const parts = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        if (/^\s+\S/.test(lines[j])) parts.push(lines[j].trim());
        else if (lines[j].trim() === "") parts.push("");
        else break;
      }
      value = parts.join(" ").replace(/\s+/g, " ").trim();
      i = j - 1;
    }

    if (!(key in fields)) fields[key] = value;
  }

  return fields;
}

export function computeDigest(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function buildManifest() {
  const content = readSkill();
  const fields = parseSkillFrontmatter(content);
  if (!fields.name) throw new Error("docs-site/skill.md frontmatter is missing name");
  if (!fields.description) throw new Error("docs-site/skill.md frontmatter is missing description");

  return {
    skills: [
      {
        name: fields.name,
        type: "skill-md",
        description: fields.description,
        url: SKILL_URL,
        digest: computeDigest(content),
      },
    ],
  };
}

export function manifestJson() {
  return `${JSON.stringify(buildManifest(), null, 2)}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const skill = readSkill();
  mkdirSync(dirname(distSkillPath), { recursive: true });
  writeFileSync(distSkillPath, skill);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestJson());
  console.log(`Wrote ${distSkillPath}`);
  console.log(`Wrote ${manifestPath}`);
}
