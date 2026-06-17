import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultCommentsPath,
  inspectCommentsMarkdown,
  normalizeAuthorRole,
  normalizeCommentScope,
} from "./comments.js";

export const COMMENTS_INDEX_FORMAT = "tunelito-comments";
export const COMMENTS_INDEX_VERSION = 1;

export function buildCommentsIndex({ targetPath, commentsPath, requireCommentsFile = false } = {}) {
  const diagnostics = [];
  const resolvedTargetPath = targetPath ? resolve(targetPath) : null;
  const resolvedCommentsPath = commentsPath
    ? resolve(commentsPath)
    : resolvedTargetPath
      ? defaultCommentsPath(resolvedTargetPath)
      : null;

  if (!resolvedTargetPath && !resolvedCommentsPath) {
    diagnostics.push(diagnostic({
      code: "comments.input-missing",
      message: "Provide a target path or comments Markdown path.",
    }));
    return indexResult({ targetPath: null, commentsPath: null, comments: [], diagnostics });
  }

  if (resolvedTargetPath) {
    if (!existsSync(resolvedTargetPath)) {
      diagnostics.push(diagnostic({
        code: "comments.target-missing",
        message: `Target path does not exist: ${resolvedTargetPath}`,
      }));
    } else {
      const targetStat = statSync(resolvedTargetPath);
      if (!targetStat.isFile() && !targetStat.isDirectory()) {
        diagnostics.push(diagnostic({
          code: "comments.target-invalid",
          message: `Target path is not a file or folder: ${resolvedTargetPath}`,
        }));
      }
    }
  }

  if (!resolvedCommentsPath) {
    diagnostics.push(diagnostic({
      code: "comments.path-missing",
      message: "Could not derive a comments Markdown path.",
    }));
    return indexResult({ targetPath: resolvedTargetPath, commentsPath: null, comments: [], diagnostics });
  }

  if (!existsSync(resolvedCommentsPath)) {
    diagnostics.push(diagnostic({
      severity: requireCommentsFile ? "error" : "info",
      code: "comments.file-missing",
      message: requireCommentsFile
        ? `Comments file does not exist: ${resolvedCommentsPath}`
        : `Comments file does not exist yet: ${resolvedCommentsPath}`,
    }));
    return indexResult({
      targetPath: resolvedTargetPath,
      commentsPath: resolvedCommentsPath,
      comments: [],
      diagnostics,
    });
  }

  const commentsStat = statSync(resolvedCommentsPath);
  if (!commentsStat.isFile()) {
    diagnostics.push(diagnostic({
      code: "comments.file-invalid",
      message: `Comments path is not a file: ${resolvedCommentsPath}`,
    }));
    return indexResult({
      targetPath: resolvedTargetPath,
      commentsPath: resolvedCommentsPath,
      comments: [],
      diagnostics,
    });
  }

  const inspection = inspectCommentsMarkdown(resolvedCommentsPath);
  diagnostics.push(...inspection.diagnostics);
  if (!inspection.raw.trim()) {
    diagnostics.push(diagnostic({
      code: "comments.file-empty",
      message: "Comments file is empty and does not look like a Tunelito comments inbox.",
    }));
  } else if (inspection.metadataCount === 0 && !isRenderedEmptyInbox(inspection.raw)) {
    diagnostics.push(diagnostic({
      code: "comments.file-unrecognized",
      message: "Comments file does not look like a Tunelito comments inbox.",
    }));
  }

  return indexResult({
    targetPath: resolvedTargetPath,
    commentsPath: resolvedCommentsPath,
    comments: inspection.comments.map(indexComment),
    diagnostics,
  });
}

function indexResult({ targetPath, commentsPath, comments, diagnostics }) {
  return {
    format: COMMENTS_INDEX_FORMAT,
    version: COMMENTS_INDEX_VERSION,
    targetPath,
    commentsPath,
    ok: !diagnostics.some((item) => item.severity === "error"),
    summary: summarizeComments(comments),
    comments,
    diagnostics,
  };
}

export function summarizeComments(comments) {
  const summary = {
    total: comments.length,
    page: 0,
    site: 0,
    owner: 0,
    visitor: 0,
    ownerApproved: 0,
  };

  for (const comment of comments) {
    if (normalizeCommentScope(comment.scope) === "site") summary.site += 1;
    else summary.page += 1;

    if (normalizeAuthorRole(comment.authorRole) === "owner") summary.owner += 1;
    else summary.visitor += 1;

    if (comment.ownerApproval?.approvedAt) summary.ownerApproved += 1;
  }

  return summary;
}

function indexComment(comment) {
  return {
    id: comment.id,
    author: comment.author,
    authorRole: normalizeAuthorRole(comment.authorRole),
    reviewerId: comment.reviewerId || null,
    ownerApproval: comment.ownerApproval || null,
    scope: normalizeCommentScope(comment.scope),
    quote: comment.quote || "",
    body: comment.body || "",
    prefix: comment.prefix || "",
    suffix: comment.suffix || "",
    path: comment.path || "",
    pagePath: comment.pagePath || "",
    textStart: Number.isFinite(comment.textStart) ? comment.textStart : null,
    textEnd: Number.isFinite(comment.textEnd) ? comment.textEnd : null,
    created: comment.created,
  };
}

function isRenderedEmptyInbox(raw) {
  return /^# Tunelito comments for `/m.test(raw) && /^_No comments yet\._$/m.test(raw);
}

function diagnostic({ code, message, severity = "error" }) {
  return { severity, code, message };
}
