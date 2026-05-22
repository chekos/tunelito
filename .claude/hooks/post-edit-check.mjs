#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const input = await readJsonFromStdin();
const filePath = input.tool_input?.file_path || input.tool_input?.path;

if (!filePath) process.exit(0);

const absolute = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), String(filePath));
const ext = extname(absolute);

if (![".js", ".mjs"].includes(ext) || !existsSync(absolute) || !statSync(absolute).isFile()) {
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--check", absolute], {
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || `node --check failed for ${filePath}`);
  process.exit(2);
}

process.exit(0);

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
