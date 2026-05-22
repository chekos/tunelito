#!/usr/bin/env node

import { relative, resolve, sep } from "node:path";

const input = await readJsonFromStdin();
const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const candidates = collectPaths(input.tool_input).map((filePath) => normalize(root, filePath));

for (const candidate of candidates) {
  const reason = protectedReason(candidate);
  if (reason) {
    console.error(`Blocked by Tunelito file guard: ${candidate} ${reason}`);
    process.exit(2);
  }
}

process.exit(0);

function collectPaths(toolInput = {}) {
  const values = [];
  if (toolInput.file_path) values.push(toolInput.file_path);
  if (toolInput.path) values.push(toolInput.path);
  if (Array.isArray(toolInput.file_paths)) values.push(...toolInput.file_paths);
  return values.filter(Boolean);
}

function normalize(root, filePath) {
  const absolute = resolve(root, String(filePath));
  const rel = relative(root, absolute);
  return rel && !rel.startsWith("..") && !rel.includes(`..${sep}`) ? rel : absolute;
}

function protectedReason(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized === "package-lock.json") return "must be changed via npm commands, not direct edits.";
  if (normalized === "files.zip") return "is an uploaded artifact, not source.";
  if (normalized === ".claude/settings.local.json") return "is personal local configuration.";
  if (normalized.startsWith(".git/") || normalized === ".git") return "is git internals.";
  if (normalized.startsWith("node_modules/") || normalized === "node_modules") return "is installed dependencies.";
  if (/\.comments\.md$/i.test(normalized)) return "contains live reviewer comments and user data.";
  if (/(^|\/)\.env(?:\.|$)/i.test(normalized)) return "may contain secrets.";
  return "";
}

async function readJsonFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
