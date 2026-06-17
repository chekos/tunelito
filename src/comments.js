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
  const authorRole = normalizeAuthorRole(input.authorRole || input.role);
  const ownerApproval = normalizeOwnerApproval(input.ownerApproval);
  const scope = normalizeCommentScope(input.scope);
  const quote = cleanText(input.quote || "", 4000);
  const body = cleanText(input.body || input.comment || "", 8000);

  if (!body.trim()) throw new Error("Comment body is empty");

  return {
    id,
    author,
    authorRole,
    ...(ownerApproval ? { ownerApproval } : {}),
    scope,
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

export function normalizeCommentScope(scope) {
  return String(scope || "").trim().toLowerCase() === "site" ? "site" : "page";
}

export function normalizeAuthorRole(role) {
  return String(role || "").trim().toLowerCase() === "owner" ? "owner" : "visitor";
}

export function isSiteComment(comment) {
  return normalizeCommentScope(comment?.scope) === "site";
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

  function update(id, updater) {
    const index = comments.findIndex((comment) => comment.id === id);
    if (index < 0) return null;
    const current = comments[index];
    const patch = typeof updater === "function" ? updater({ ...current }) : updater;
    const next = normalizeComment({
      ...current,
      ...(patch || {}),
      id: current.id,
      created: current.created,
    });
    comments[index] = next;
    write();
    return next;
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
    update,
    write,
  };
}

export function createMemoryCommentStore() {
  const comments = [];

  function all() {
    return comments.slice();
  }

  function add(input) {
    const comment = normalizeComment(input);
    comments.push(comment);
    return comment;
  }

  function update(id, updater) {
    const index = comments.findIndex((comment) => comment.id === id);
    if (index < 0) return null;
    const current = comments[index];
    const patch = typeof updater === "function" ? updater({ ...current }) : updater;
    const next = normalizeComment({
      ...current,
      ...(patch || {}),
      id: current.id,
      created: current.created,
    });
    comments[index] = next;
    return next;
  }

  return {
    get commentsPath() {
      return null;
    },
    all,
    add,
    update,
    write() {},
  };
}

export function renderCommentsMarkdown({ comments, sourcePath }) {
  const sourceName = sourcePath ? basename(sourcePath) : "HTML page";
  const lines = [
    `# Tunelito comments for \`${visibleMarkdownText(sourceName)}\``,
    "",
    "_This file is updated live by Tunelito. The hidden metadata comments let Tunelito restore the session if you restart it._",
    "",
  ];

  if (!comments.length) {
    lines.push("_No comments yet._", "");
    return lines.join("\n");
  }

  for (const comment of comments) {
    lines.push(...renderCommentMarkdownLines(comment));
  }

  return lines.join("\n");
}

export function loadCommentsFromMarkdown(commentsPath) {
  if (!commentsPath || !existsSync(commentsPath)) return [];
  const raw = readFileSync(commentsPath, "utf8");
  const comments = [];
  const pattern = /^<!--[ \t]*tunelito-comment:[ \t]*([A-Za-z0-9_-]+)[ \t]*-->[ \t]*$/gm;
  let match;
  while ((match = pattern.exec(raw))) {
    try {
      const comment = normalizeComment(decodeComment(match[1]), new Date(0));
      const sectionEnd = renderedCommentSectionEndOffset(raw, match.index, match[0], comment);
      if (sectionEnd === null) continue;
      comments.push(comment);
      pattern.lastIndex = Math.max(pattern.lastIndex, sectionEnd);
    } catch {
      // Ignore stale or hand-edited metadata; the readable markdown still remains.
    }
  }
  return comments;
}

function renderCommentMarkdownLines(comment, options = {}) {
  const lines = [];
  lines.push(`${METADATA_PREFIX} ${encodeComment(comment)} ${METADATA_SUFFIX}`);
  lines.push(renderCommentHeading(comment, options));
  lines.push("");
  const quote = visibleMarkdownText(comment.quote || "", options);
  if (quote.trim()) {
    for (const line of quote.trim().split(/\r?\n/)) {
      lines.push(`> ${line}`);
    }
  } else {
    lines.push(`_${scopeLabel(comment.scope)} note (no selected text)._`);
  }
  lines.push("");
  lines.push(visibleMarkdownText(comment.body, options).trim());
  lines.push("");
  const contextLine = renderCommentContextLine(comment, options);
  if (contextLine) {
    lines.push(contextLine);
    lines.push("");
  }
  return lines;
}

function renderCommentHeading(comment, options = {}) {
  const role = normalizeAuthorRole(comment.authorRole) === "owner" ? " (owner)" : "";
  return `## ${visibleMarkdownText(comment.author, options)}${role} at ${visibleMarkdownText(formatDate(comment.created), options)}`;
}

function renderCommentContextLine(comment, options = {}) {
  const context = [];
  if (normalizeAuthorRole(comment.authorRole) === "owner") context.push("author role: `owner`");
  if (comment.ownerApproval?.approvedAt) {
    const by = cleanText(comment.ownerApproval.approvedBy || "Owner", 80) || "Owner";
    context.push(`approved by owner: \`${visibleMarkdownText(by, options)}\``);
    context.push(`approved at: \`${visibleMarkdownText(formatDate(comment.ownerApproval.approvedAt), options)}\``);
  }
  context.push(`scope: \`${normalizeCommentScope(comment.scope)}\``);
  if (comment.pagePath) context.push(`page: \`${visibleMarkdownText(comment.pagePath, options)}\``);
  if (comment.path) context.push(`path: \`${visibleMarkdownText(comment.path, options)}\``);
  if (Number.isFinite(comment.textStart)) context.push(`text offset: ${comment.textStart}`);
  if (comment.id) context.push(`id: \`${visibleMarkdownText(comment.id, options)}\``);
  if (!context.length) return "";
  return `_Context: ${context.join(" · ")}_`;
}

function renderedCommentSectionEndOffset(raw, offset, metadataLine, comment) {
  return matchRenderedCommentSection(raw, offset, metadataLine, comment)
    ?? matchRenderedCommentSection(raw, offset, metadataLine, comment, { escapeMetadataMarkers: false });
}

function matchRenderedCommentSection(raw, offset, metadataLine, comment, options = {}) {
  const expected = renderCommentMarkdownLines(comment, options);
  expected[0] = metadataLine;
  return matchLineEndingTolerant(raw, offset, expected.join("\n"));
}

function matchLineEndingTolerant(raw, offset, expected) {
  let rawIndex = offset;
  let expectedIndex = 0;
  while (expectedIndex < expected.length) {
    if (expected[expectedIndex] === "\n") {
      if (raw.startsWith("\r\n", rawIndex)) rawIndex += 2;
      else if (raw[rawIndex] === "\n") rawIndex += 1;
      else return null;
      expectedIndex += 1;
    } else if (raw[rawIndex] === expected[expectedIndex]) {
      rawIndex += 1;
      expectedIndex += 1;
    } else {
      return null;
    }
  }
  return rawIndex;
}

function cleanText(value, limit) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .slice(0, limit);
}

function normalizeOwnerApproval(input) {
  if (!input || typeof input !== "object") return null;
  const approvedAt = cleanText(input.approvedAt || input.at || "", 80);
  if (!approvedAt) return null;
  return {
    approvedBy: cleanText(input.approvedBy || input.by || "Owner", 80) || "Owner",
    approvedAt,
    fingerprint: cleanText(input.fingerprint || "", 128),
  };
}

function visibleMarkdownText(value, { escapeMetadataMarkers = true } = {}) {
  const text = String(value ?? "");
  if (!escapeMetadataMarkers) return text;
  return text.replace(/<!--[ \t]*tunelito-comment:/g, "&lt;!-- tunelito-comment:");
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

function scopeLabel(scope) {
  return normalizeCommentScope(scope) === "site" ? "Site" : "Page";
}
