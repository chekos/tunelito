import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, basename } from "node:path";

const METADATA_PREFIX = "<!-- tunelito-comment:";
const METADATA_SUFFIX = "-->";

export function defaultCommentsPath(filePath) {
  return filePath.replace(/\.html?$/i, "") + ".comments.md";
}

export function normalizeComment(input, now = new Date()) {
  const id = input.id || `c_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const author = cleanText(input.author || "Anonymous", 80) || "Anonymous";
  const quote = cleanText(input.quote || "", 4000);
  const body = cleanText(input.body || input.comment || "", 8000);

  if (!quote.trim()) throw new Error("Comment is missing a selected quote");
  if (!body.trim()) throw new Error("Comment body is empty");

  return {
    id,
    author,
    quote,
    body,
    prefix: cleanText(input.prefix || "", 1000),
    suffix: cleanText(input.suffix || "", 1000),
    path: cleanText(input.path || "", 1000),
    pagePath: cleanText(input.pagePath || input.url || "", 1000),
    textStart: Number.isFinite(input.textStart) ? input.textStart : null,
    textEnd: Number.isFinite(input.textEnd) ? input.textEnd : null,
    created: input.created || now.toISOString(),
  };
}

export function createCommentStore({ commentsPath, sourcePath }) {
  let comments = loadCommentsFromMarkdown(commentsPath);

  function all() {
    return comments.slice();
  }

  function add(input) {
    const comment = normalizeComment(input);
    comments.push(comment);
    write();
    return comment;
  }

  function write() {
    mkdirSync(dirname(commentsPath), { recursive: true });
    const temp = `${commentsPath}.tmp`;
    writeFileSync(temp, renderCommentsMarkdown({ comments, sourcePath }), "utf8");
    renameSync(temp, commentsPath);
  }

  return {
    get commentsPath() {
      return commentsPath;
    },
    all,
    add,
    write,
  };
}

export function renderCommentsMarkdown({ comments, sourcePath }) {
  const sourceName = sourcePath ? basename(sourcePath) : "HTML page";
  const lines = [
    `# Tunelito comments for \`${sourceName}\``,
    "",
    "_This file is updated live by Tunelito. The hidden metadata comments let Tunelito restore the session if you restart it._",
    "",
  ];

  if (!comments.length) {
    lines.push("_No comments yet._", "");
    return lines.join("\n");
  }

  for (const comment of comments) {
    lines.push(`${METADATA_PREFIX} ${encodeComment(comment)} ${METADATA_SUFFIX}`);
    lines.push(`## ${comment.author} at ${formatDate(comment.created)}`);
    lines.push("");
    for (const line of comment.quote.trim().split(/\r?\n/)) {
      lines.push(`> ${line}`);
    }
    lines.push("");
    lines.push(comment.body.trim());
    lines.push("");
    const context = [];
    if (comment.path) context.push(`path: \`${comment.path}\``);
    if (Number.isFinite(comment.textStart)) context.push(`text offset: ${comment.textStart}`);
    if (context.length) {
      lines.push(`_Context: ${context.join(" · ")}_`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function loadCommentsFromMarkdown(commentsPath) {
  if (!commentsPath || !existsSync(commentsPath)) return [];
  const raw = readFileSync(commentsPath, "utf8");
  const comments = [];
  const pattern = /<!--\s*tunelito-comment:\s*([A-Za-z0-9_-]+)\s*-->/g;
  let match;
  while ((match = pattern.exec(raw))) {
    try {
      comments.push(normalizeComment(decodeComment(match[1]), new Date(0)));
    } catch {
      // Ignore stale or hand-edited metadata; the readable markdown still remains.
    }
  }
  return comments;
}

function cleanText(value, limit) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .slice(0, limit);
}

function encodeComment(comment) {
  return Buffer.from(JSON.stringify(comment), "utf8").toString("base64url");
}

function decodeComment(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
