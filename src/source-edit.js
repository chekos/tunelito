import { isUtf8 } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const MAX_EDITABLE_SOURCE_BYTES = 2 * 1024 * 1024;

export class SourceEditError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SourceEditError";
    this.status = status;
  }
}

export function readMarkdownSourceSnapshot(path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let before;
    let buffer;
    let after;
    try {
      before = statSync(path, { bigint: true });
      if (!before.isFile()) throw new SourceEditError(404, "Editable Markdown source not found.");
      buffer = readFileSync(path);
      after = statSync(path, { bigint: true });
    } catch (error) {
      if (error instanceof SourceEditError) throw error;
      throw sourceFilesystemError(error, "Could not read the Markdown source.");
    }

    if (fileIdentity(before) !== fileIdentity(after)) continue;
    if (buffer.length > MAX_EDITABLE_SOURCE_BYTES) {
      throw new SourceEditError(413, `Markdown source exceeds the ${formatByteLimit(MAX_EDITABLE_SOURCE_BYTES)} editor limit.`);
    }
    if (!isUtf8(buffer)) throw new SourceEditError(415, "Markdown source must be valid UTF-8 to edit in the browser.");
    return {
      buffer,
      source: buffer.toString("utf8"),
      etag: sourceEtag(buffer, after),
      mode: Number(after.mode & 0o7777n),
    };
  }

  throw new SourceEditError(409, "Markdown source changed while it was being read. Try again.");
}

export function writeMarkdownSourceSnapshot(path, source, expectedEtag) {
  if (typeof source !== "string") throw new SourceEditError(400, "Markdown source body is required.");
  const buffer = Buffer.from(source, "utf8");
  if (buffer.length > MAX_EDITABLE_SOURCE_BYTES) {
    throw new SourceEditError(413, `Markdown source exceeds the ${formatByteLimit(MAX_EDITABLE_SOURCE_BYTES)} editor limit.`);
  }

  const current = readMarkdownSourceSnapshot(path);
  if (!expectedEtag) throw new SourceEditError(428, "Saving requires the source revision from the editor.");
  if (expectedEtag !== current.etag) throw new SourceEditError(412, "Markdown source changed on disk. Your browser draft was not saved.");
  if (buffer.equals(current.buffer)) return { ...current, changed: false };

  const tempPath = join(dirname(path), `.${basename(path)}.tunelito-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(tempPath, "wx", current.mode);
    writeFileSync(descriptor, buffer);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    chmodSync(tempPath, current.mode);

    const latest = readMarkdownSourceSnapshot(path);
    if (latest.etag !== expectedEtag) {
      throw new SourceEditError(412, "Markdown source changed on disk. Your browser draft was not saved.");
    }

    renameSync(tempPath, path);
  } catch (error) {
    if (descriptor != null) {
      try {
        closeSync(descriptor);
      } catch {
        // Cleanup continues below.
      }
    }
    rmSync(tempPath, { force: true });
    if (error instanceof SourceEditError) throw error;
    throw sourceFilesystemError(error, "Could not save the Markdown source.");
  }

  return { ...readMarkdownSourceSnapshot(path), changed: true };
}

export function readBoundedUtf8Body(req, { limit = MAX_EDITABLE_SOURCE_BYTES } = {}) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    req.resume();
    return Promise.reject(new SourceEditError(413, `Markdown source exceeds the ${formatByteLimit(limit)} editor limit.`));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > limit) {
        failed = true;
        reject(new SourceEditError(413, `Markdown source exceeds the ${formatByteLimit(limit)} editor limit.`));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (failed) return;
      const buffer = Buffer.concat(chunks, length);
      if (!isUtf8(buffer)) {
        reject(new SourceEditError(415, "Markdown source must be valid UTF-8 to edit in the browser."));
        return;
      }
      resolve(buffer.toString("utf8"));
    });
    req.on("error", () => {
      if (!failed) reject(new SourceEditError(400, "Could not read the Markdown source request."));
    });
  });
}

function sourceEtag(buffer, stats) {
  const hash = createHash("sha256");
  hash.update(fileIdentity(stats));
  hash.update("\0");
  hash.update(buffer);
  return `"tunelito-${hash.digest("base64url")}"`;
}

function fileIdentity(stats) {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs].join(":");
}

function sourceFilesystemError(error, fallback) {
  if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return new SourceEditError(404, "Editable Markdown source not found.");
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) return new SourceEditError(403, "Markdown source is not writable.");
  return new SourceEditError(500, fallback);
}

function formatByteLimit(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
