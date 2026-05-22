#!/usr/bin/env node

const input = await readJsonFromStdin();
const command = String(input.tool_input?.command || "");

const blocks = [
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Do not use destructive git reset. Preserve user and agent work; use a focused patch or revert commit.",
  },
  {
    pattern: /\bgit\s+checkout\s+--\b/i,
    reason: "Do not use destructive git checkout on files. Use a focused patch so unrelated work is preserved.",
  },
  {
    pattern: /\bgit\s+clean\b.*(?:\s-|=).*f/i,
    reason: "Do not force-clean the workspace. Inspect untracked files and remove only explicit generated artifacts.",
  },
  {
    pattern: /\bgit\s+push\b.*--force/i,
    reason: "Force-push is blocked for this agent-maintained repo.",
  },
  {
    pattern: /\bgit\s+commit\b.*--no-verify/i,
    reason: "Do not bypass verification hooks. Fix the failing check or document why it cannot run.",
  },
  {
    pattern: /\bnpm\s+publish\b/i,
    reason: "Use docs/RELEASING.md and trusted publishing instead of direct npm publish.",
  },
  {
    pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash)\b/i,
    reason: "Pipe-to-shell installers are blocked. Download, inspect, and document any installer first.",
  },
  {
    pattern: /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:\/|~|\$HOME|\.git|node_modules)\b/i,
    reason: "Dangerous recursive remove target is blocked.",
  },
  {
    pattern: /\bchmod\s+-R\s+777\b/i,
    reason: "Recursive world-writable permissions are blocked.",
  },
  {
    pattern: /\b(?:cat|sed|awk|perl|less|more|head|tail)\b[\s\S]*(?:^|\s)\.env(?:\s|$|[.*])/i,
    reason: "Secret-file reads are blocked. Do not print .env contents into agent context.",
  },
  {
    pattern: /\b(?:cat|tee)\b[\s\S]*>\s*(?!\/tmp\/)/i,
    reason: "Use Edit/Write/apply_patch for repo file edits instead of shell redirection.",
  },
  {
    pattern: /\b(?:sed\s+-i|perl\s+-pi)\b/i,
    reason: "Use structured file edits instead of in-place shell rewriting.",
  },
];

const block = blocks.find(({ pattern }) => pattern.test(command));
if (block) {
  console.error(`Blocked by Tunelito agent guard: ${block.reason}`);
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
