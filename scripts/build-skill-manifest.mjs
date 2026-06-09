#!/usr/bin/env node

// Generates docs-site/.well-known/agent-skills/index.json from docs-site/skill.md.
//
// The manifest lets an agent or the `npx skills` installer discover the Tunelito
// skill from a base URL (RFC 8615 well-known path), the same pattern Stripe,
// Supabase, and Cloudflare use. The skill content stays single-sourced in
// docs-site/skill.md; this script derives the name, description, and a content
// digest from it so the manifest cannot silently drift. The Mintlify docs
// validator recomputes this and fails docs:check when the committed manifest is
// stale, so run `npm run skill:manifest` whenever docs-site/skill.md changes.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const skillPath = join(repoRoot, "docs-site", "skill.md");
export const manifestPath = join(repoRoot, "docs-site", ".well-known", "agent-skills", "index.json");

// Where an agent can fetch the raw skill once it reads the manifest.
const SKILL_URL = "https://raw.githubusercontent.com/chekos/tunelito/main/docs-site/skill.md";

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
  const content = readFileSync(skillPath, "utf8");
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
  const json = manifestJson();
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, json);
  console.log(`Wrote ${manifestPath}`);
}
