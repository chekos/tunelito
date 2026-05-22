import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommentStore, loadCommentsFromMarkdown, renderCommentsMarkdown } from "../src/comments.js";

test("comment store writes readable markdown and restores hidden metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-"));
  const commentsPath = join(dir, "page.comments.md");
  const sourcePath = join(dir, "page.html");
  const store = createCommentStore({ commentsPath, sourcePath });

  const comment = store.add({
    author: "Jane",
    quote: "the selected sentence",
    body: "This should be clearer.",
    prefix: "before ",
    suffix: " after",
    path: "body > main > p",
    textStart: 20,
    textEnd: 41,
  });

  const markdown = readFileSync(commentsPath, "utf8");
  assert.match(markdown, /# Tunelito comments for `page\.html`/);
  assert.match(markdown, /## Jane at /);
  assert.match(markdown, /> the selected sentence/);
  assert.match(markdown, /This should be clearer\./);
  assert.match(markdown, /<!-- tunelito-comment:/);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, comment.id);
  assert.equal(restored[0].author, "Jane");
  assert.equal(restored[0].quote, "the selected sentence");
  assert.equal(restored[0].body, "This should be clearer.");
});

test("renderCommentsMarkdown handles an empty comment list", () => {
  const markdown = renderCommentsMarkdown({ comments: [], sourcePath: "/tmp/example.html" });
  assert.match(markdown, /_No comments yet\._/);
});
