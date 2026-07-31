import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_EDITABLE_SOURCE_BYTES,
  SourceEditError,
  readMarkdownSourceSnapshot,
  writeMarkdownSourceSnapshot,
} from "../src/source-edit.js";

test("source snapshots preserve exact UTF-8 and atomic saves preserve permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-source-edit-"));
  const path = join(dir, "notes.md");
  const original = "---\ntitle: Café ☕\n---\n\n# Notes\n";
  writeFileSync(path, original);
  chmodSync(path, 0o640);

  const snapshot = readMarkdownSourceSnapshot(path);
  assert.equal(snapshot.source, original);
  assert.match(snapshot.etag, /^"tunelito-[A-Za-z0-9_-]+"$/);

  const saved = writeMarkdownSourceSnapshot(path, `${original}\nUpdated.\n`, snapshot.etag);
  assert.equal(saved.changed, true);
  assert.notEqual(saved.etag, snapshot.etag);
  assert.equal(readFileSync(path, "utf8"), `${original}\nUpdated.\n`);
  assert.equal(statSync(path).mode & 0o777, 0o640);
});

test("source saves reject stale revisions without overwriting external changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-source-conflict-"));
  const path = join(dir, "notes.md");
  writeFileSync(path, "# First\n");
  const snapshot = readMarkdownSourceSnapshot(path);
  writeFileSync(path, "# External\n");

  assert.throws(
    () => writeMarkdownSourceSnapshot(path, "# Browser\n", snapshot.etag),
    (error) => error instanceof SourceEditError && error.status === 412,
  );
  assert.equal(readFileSync(path, "utf8"), "# External\n");
});

test("source snapshots reject invalid UTF-8 and oversized files", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-source-bounds-"));
  const invalidPath = join(dir, "invalid.md");
  const largePath = join(dir, "large.md");
  writeFileSync(invalidPath, Buffer.from([0xff, 0xfe, 0xfd]));
  writeFileSync(largePath, Buffer.alloc(MAX_EDITABLE_SOURCE_BYTES + 1, 0x61));

  assert.throws(
    () => readMarkdownSourceSnapshot(invalidPath),
    (error) => error instanceof SourceEditError && error.status === 415,
  );
  assert.throws(
    () => readMarkdownSourceSnapshot(largePath),
    (error) => error instanceof SourceEditError && error.status === 413,
  );
});

test("unchanged source saves do not replace the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-source-unchanged-"));
  const path = join(dir, "notes.md");
  writeFileSync(path, "# Same\n");
  const snapshot = readMarkdownSourceSnapshot(path);
  const saved = writeMarkdownSourceSnapshot(path, snapshot.source, snapshot.etag);

  assert.equal(saved.changed, false);
  assert.equal(saved.etag, snapshot.etag);
});
