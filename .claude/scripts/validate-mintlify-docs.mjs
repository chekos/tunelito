#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const docsRoot = join(root, "docs-site");
const errors = [];

const config = readJson("docs-site/docs.json");
if (config) {
  if (config.$schema !== "https://mintlify.com/docs.json") {
    errors.push("docs-site/docs.json: missing Mintlify schema");
  }
  if (!config.name) errors.push("docs-site/docs.json: missing name");
  if (!config.theme) errors.push("docs-site/docs.json: missing theme");
  if (!isHexColor(config.colors?.primary)) {
    errors.push("docs-site/docs.json: missing colors.primary hex color");
  }
  if (!config.navigation) errors.push("docs-site/docs.json: missing navigation");
  for (const page of collectPages(config.navigation)) {
    if (page.startsWith("/") || page.endsWith(".md") || page.endsWith(".mdx")) {
      errors.push(`docs-site/docs.json: navigation page "${page}" should be extensionless and relative`);
      continue;
    }
    const mdx = join(docsRoot, `${page}.mdx`);
    const md = join(docsRoot, `${page}.md`);
    if (!existsSync(mdx) && !existsSync(md)) {
      errors.push(`docs-site/docs.json: navigation references missing page "${page}"`);
    }
  }
}

for (const required of [
  "docs-site/README.md",
  "docs-site/skill.md",
  "docs-site/favicon.svg",
  "docs-site/logo-light.svg",
  "docs-site/logo-dark.svg",
]) {
  requireFile(required);
}

validateSkill("docs-site/skill.md");

if (errors.length) {
  for (const error of errors) console.error(`mintlify docs: ${error}`);
  process.exit(1);
}

console.log("mintlify docs: ok");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
    return null;
  }
}

function requireFile(file) {
  const path = join(root, file);
  if (!existsSync(path) || !statSync(path).isFile()) errors.push(`missing ${file}`);
}

function isHexColor(value) {
  return typeof value === "string" && /^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(value);
}

function validateSkill(file) {
  const path = join(root, file);
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    errors.push(`${file}: missing YAML frontmatter`);
    return;
  }

  for (const field of ["name", "description", "license", "compatibility"]) {
    if (!new RegExp(`^${field}:\\s*\\S`, "m").test(frontmatter[1])) {
      errors.push(`${file}: missing frontmatter field ${field}`);
    }
  }
}

function collectPages(node) {
  const pages = [];
  visit(node);
  return pages;

  function visit(value) {
    if (!value) return;
    if (typeof value === "string") {
      pages.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.root === "string") pages.push(value.root);
      if (Array.isArray(value.pages)) visit(value.pages);
      for (const key of ["groups", "tabs", "anchors", "dropdowns", "versions", "languages"]) {
        if (Array.isArray(value[key])) visit(value[key]);
      }
    }
  }
}
