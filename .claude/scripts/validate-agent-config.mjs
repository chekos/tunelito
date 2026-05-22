#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const errors = [];
const root = process.cwd();

requireFile("AGENTS.md");
requireFile("CLAUDE.md");
requireFile(".claude/settings.json");

validateJson(".claude/settings.json");
validateSkills();
validateAgents();
validatePlaybooks();

if (errors.length) {
  for (const error of errors) console.error(`agent config: ${error}`);
  process.exit(1);
}

console.log("agent config: ok");

function validateSkills() {
  const skillsDir = join(root, ".claude/skills");
  if (!existsSync(skillsDir)) {
    errors.push("missing .claude/skills directory");
    return;
  }

  for (const entry of sortedDirs(skillsDir)) {
    const skillPath = join(".claude/skills", entry, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push(`${entry}: missing SKILL.md`);
      continue;
    }

    const { frontmatter, body } = readFrontmatter(skillPath);
    const name = frontmatter.name || entry;
    const description = frontmatter.description || "";

    if (name !== entry) errors.push(`${skillPath}: name should match directory (${entry})`);
    if (!/^[a-z0-9-]{1,64}$/.test(name)) errors.push(`${skillPath}: invalid name "${name}"`);
    if (!description.trim()) errors.push(`${skillPath}: missing description`);
    if (description.length > 1024) errors.push(`${skillPath}: description is over 1024 characters`);
    if (!body.trim()) errors.push(`${skillPath}: empty body`);
    if (/<\/?[a-z][\s\S]*>/i.test(body)) errors.push(`${skillPath}: avoid XML/HTML-like instruction tags in skill body`);

    if (isSideEffectSkill(name) && frontmatter["disable-model-invocation"] !== "true") {
      errors.push(`${skillPath}: side-effect workflow must set disable-model-invocation: true`);
    }

    if (frontmatter["context"] === "fork" && !frontmatter.agent) {
      errors.push(`${skillPath}: context: fork should name an agent`);
    }
  }
}

function validateAgents() {
  const agentsDir = join(root, ".claude/agents");
  if (!existsSync(agentsDir)) {
    errors.push("missing .claude/agents directory");
    return;
  }

  for (const file of sortedFiles(agentsDir, ".md")) {
    const agentPath = join(".claude/agents", file);
    const { frontmatter, body } = readFrontmatter(agentPath);
    const expected = basename(file, ".md");

    if (frontmatter.name !== expected) errors.push(`${agentPath}: name should match filename (${expected})`);
    if (!frontmatter.description) errors.push(`${agentPath}: missing description`);
    if (!body.trim()) errors.push(`${agentPath}: empty body`);
  }
}

function validatePlaybooks() {
  const required = [
    "docs/agents/START_HERE.md",
    "docs/agents/WORKFLOW.md",
    "docs/agents/QUALITY_GATES.md",
    "docs/agents/ARCHITECTURE.md",
    "docs/agents/SECURITY_REVIEW.md",
    "docs/agents/RELEASE_PLAYBOOK.md",
    "docs/agents/HOOKS.md",
    "docs/agents/SKILLS.md",
  ];

  for (const file of required) requireFile(file);
}

function readFrontmatter(file) {
  const raw = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(raw);
  if (!match) {
    errors.push(`${file}: missing YAML frontmatter`);
    return { frontmatter: {}, body: raw };
  }

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) {
      errors.push(`${file}: invalid frontmatter line "${line}"`);
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] };
}

function validateJson(file) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error.message})`);
  }
}

function requireFile(file) {
  if (!existsSync(join(root, file))) errors.push(`missing ${file}`);
}

function sortedDirs(dir) {
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .sort();
}

function sortedFiles(dir, ext) {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(ext) && statSync(join(dir, entry)).isFile())
    .sort();
}

function isSideEffectSkill(name) {
  return [
    "tunelito-live-smoke",
    "tunelito-pr",
    "tunelito-release",
    "tunelito-ship",
  ].includes(name);
}
