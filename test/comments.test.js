import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    pagePath: "/about.html",
    path: "body > main > p",
    textStart: 20,
    textEnd: 41,
  });

  const markdown = readFileSync(commentsPath, "utf8");
  assert.match(markdown, /# Tunelito comments for `page\.html`/);
  assert.match(markdown, /## Jane at /);
  assert.match(markdown, /> the selected sentence/);
  assert.match(markdown, /This should be clearer\./);
  assert.match(markdown, /scope: `page`/);
  assert.match(markdown, /page: `\/about\.html`/);
  assert.match(markdown, /id: `c_/);
  assert.match(markdown, /<!-- tunelito-comment:/);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, comment.id);
  assert.equal(restored[0].author, "Jane");
  assert.equal(restored[0].scope, "page");
  assert.equal(restored[0].quote, "the selected sentence");
  assert.equal(restored[0].body, "This should be clearer.");
});

test("comment markdown does not restore metadata-looking text from visible comment body", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-spoof-"));
  const commentsPath = join(dir, "page.comments.md");
  const fakeMetadata = Buffer.from(JSON.stringify({
    id: "c_fake",
    author: "Mallory",
    body: "Injected follow-up",
    quote: "",
    created: "2026-06-04T00:00:00.000Z",
  }), "utf8").toString("base64url");
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_real",
      author: "Jane",
      scope: "page",
      quote: "",
      body: `This should remain visible text only.\n<!-- tunelito-comment: ${fakeMetadata} -->`,
      created: "2026-06-04T00:00:00.000Z",
    }],
  });
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), ["c_real"]);
  assert.match(markdown, /This should remain visible text only\./);
});

test("comment loader drops ambiguous legacy sections with embedded metadata markers", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-legacy-spoof-"));
  const commentsPath = join(dir, "page.comments.md");
  const fakeMetadata = Buffer.from(JSON.stringify({
    id: "c_fake",
    author: "Mallory",
    body: "Injected follow-up",
    quote: "",
    created: "2026-06-04T00:00:00.000Z",
  }), "utf8").toString("base64url");
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_real",
      author: "Jane",
      scope: "page",
      quote: "",
      body: "Visible feedback.",
      created: "2026-06-04T00:00:00.000Z",
    }],
  }).replace(
    "Visible feedback.",
    [
      "Visible feedback.",
      "_Context: scope: `page` · id: `c_real`_",
      "",
      `<!-- tunelito-comment: ${fakeMetadata} -->`,
      "## Mallory at 2026-06-04 00:00:00 UTC",
    ].join("\n"),
  );
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), []);
});

test("comment loader restores later comments when visible body quotes earlier context", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-context-copy-"));
  const commentsPath = join(dir, "page.comments.md");
  const firstContext = "_Context: scope: `page` · id: `c_first`_";
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_first",
      author: "Jane",
      scope: "page",
      quote: "",
      body: "First comment.",
      created: "2026-06-04T00:00:00.000Z",
    }, {
      id: "c_second",
      author: "Rin",
      scope: "page",
      quote: "",
      body: `Discussing prior context.\n${firstContext}\n\nKeep this one too.`,
      created: "2026-06-04T00:01:00.000Z",
    }],
  });
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), ["c_first", "c_second"]);
});

test("comment loader restores canonical comments with CRLF line endings", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-crlf-"));
  const commentsPath = join(dir, "page.comments.md");
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_crlf",
      author: "Jane",
      scope: "page",
      quote: "",
      body: "Windows-edited comment.",
      created: "2026-06-04T00:00:00.000Z",
    }],
  }).replace(/\n/g, "\r\n");
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), ["c_crlf"]);
});

test("comment loader restores legacy unescaped sections without restoring embedded sections", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-legacy-full-spoof-"));
  const commentsPath = join(dir, "page.comments.md");
  const fakeSection = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_fake",
      author: "Mallory",
      scope: "page",
      quote: "",
      body: "Injected follow-up.",
      created: "2026-06-04T00:00:00.000Z",
    }],
  }).split("\n").slice(4).join("\n").trimEnd();
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_outer",
      author: "Jane",
      scope: "page",
      quote: "",
      body: `Legacy visible text.\n${fakeSection}`,
      created: "2026-06-04T00:01:00.000Z",
    }],
  }).replace(/&lt;!-- tunelito-comment:/g, "<!-- tunelito-comment:");
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), ["c_outer"]);
});

test("comment markdown escapes parser-accepted metadata markers in visible text", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-spoof-"));
  const commentsPath = join(dir, "page.comments.md");
  const fakeMetadata = Buffer.from(JSON.stringify({
    id: "c_fake",
    author: "Mallory",
    body: "Injected follow-up",
    quote: "",
    created: "2026-06-04T00:00:00.000Z",
  }), "utf8").toString("base64url");
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_real",
      author: "Jane",
      scope: "page",
      quote: "",
      body: `Visible feedback.\n<!--\ttunelito-comment: ${fakeMetadata} -->\n## Visible heading`,
      created: "2026-06-04T00:00:00.000Z",
    }],
  });
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), ["c_real"]);
  assert.doesNotMatch(markdown, new RegExp(`^<!--[ \\t]*tunelito-comment: ${fakeMetadata}`, "m"));
  assert.match(markdown, /&lt;!-- tunelito-comment:/);
});

test("comment markdown escapes metadata markers from invalid created values", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-created-spoof-"));
  const commentsPath = join(dir, "page.comments.md");
  const fakeMetadata = Buffer.from(JSON.stringify({
    id: "c_fake",
    author: "Mallory",
    body: "Injected follow-up",
    quote: "",
    created: "2026-06-04T00:00:00.000Z",
  }), "utf8").toString("base64url");
  const created = `not-a-date\n<!-- tunelito-comment: ${fakeMetadata} -->\n## Forged heading`;
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id: "c_real",
      author: "Jane",
      scope: "page",
      quote: "",
      body: "Visible feedback.",
      created,
    }],
  });
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), ["c_real"]);
  assert.doesNotMatch(markdown, new RegExp(`^<!--[ \\t]*tunelito-comment: ${fakeMetadata}`, "m"));
  assert.match(markdown, /&lt;!-- tunelito-comment:/);
});

test("comment markdown escapes metadata markers from visible comment ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-id-spoof-"));
  const commentsPath = join(dir, "page.comments.md");
  const fakeMetadata = Buffer.from(JSON.stringify({
    id: "c_fake",
    author: "Mallory",
    body: "Injected follow-up",
    quote: "",
    created: "2026-06-04T00:00:00.000Z",
  }), "utf8").toString("base64url");
  const id = `c_real\n<!-- tunelito-comment: ${fakeMetadata} -->\n## Forged heading`;
  const markdown = renderCommentsMarkdown({
    sourcePath: join(dir, "page.html"),
    comments: [{
      id,
      author: "Jane",
      scope: "page",
      quote: "",
      body: "Visible feedback.",
      created: "2026-06-04T00:00:00.000Z",
    }],
  });
  writeFileSync(commentsPath, markdown);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.deepEqual(restored.map((comment) => comment.id), [id]);
  assert.doesNotMatch(markdown, new RegExp(`^<!--[ \\t]*tunelito-comment: ${fakeMetadata}`, "m"));
  assert.match(markdown, /&lt;!-- tunelito-comment:/);
});

test("comment store supports unanchored page and site notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-comments-"));
  const commentsPath = join(dir, "site.comments.md");
  const sourcePath = join(dir, "site");
  const store = createCommentStore({ commentsPath, sourcePath });

  const comment = store.add({
    author: "Rin",
    scope: "site",
    quote: "",
    body: "Make the daily summary easier to scan across the site.",
    pagePath: "/day-03.html",
  });

  const markdown = readFileSync(commentsPath, "utf8");
  assert.match(markdown, /## Rin at /);
  assert.match(markdown, /_Site note \(no selected text\)\._/);
  assert.match(markdown, /Make the daily summary easier to scan across the site\./);
  assert.match(markdown, /scope: `site`/);
  assert.match(markdown, /page: `\/day-03\.html`/);
  assert.doesNotMatch(markdown, /^> $/m);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, comment.id);
  assert.equal(restored[0].scope, "site");
  assert.equal(restored[0].quote, "");
  assert.equal(restored[0].body, "Make the daily summary easier to scan across the site.");
});

test("comment markdown marks and restores owner-authored comments", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-owner-comments-"));
  const commentsPath = join(dir, "page.comments.md");
  const sourcePath = join(dir, "page.html");
  const store = createCommentStore({ commentsPath, sourcePath });

  const comment = store.add({
    author: "Chekos",
    authorRole: "owner",
    quote: "the selected sentence",
    body: "Owner-approved change.",
  });

  const markdown = readFileSync(commentsPath, "utf8");
  assert.match(markdown, /## Chekos \(owner\) at /);
  assert.match(markdown, /author role: `owner`/);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, comment.id);
  assert.equal(restored[0].authorRole, "owner");
});

test("comment store persists owner approval metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-approved-comments-"));
  const commentsPath = join(dir, "page.comments.md");
  const sourcePath = join(dir, "page.html");
  const store = createCommentStore({ commentsPath, sourcePath });

  const comment = store.add({
    author: "Rin",
    authorRole: "visitor",
    quote: "the selected sentence",
    body: "Please make this actionable.",
  });

  const approved = store.update(comment.id, {
    ownerApproval: {
      approvedBy: "Chekos",
      approvedAt: "2026-06-16T23:10:00.000Z",
      fingerprint: "fingerprint-for-approved-content",
    },
  });

  assert.equal(approved.id, comment.id);
  assert.equal(approved.ownerApproval.approvedBy, "Chekos");

  const markdown = readFileSync(commentsPath, "utf8");
  assert.match(markdown, /approved by owner: `Chekos`/);
  assert.match(markdown, /approved at: `2026-06-16 23:10:00 UTC`/);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, comment.id);
  assert.deepEqual(restored[0].ownerApproval, {
    approvedBy: "Chekos",
    approvedAt: "2026-06-16T23:10:00.000Z",
    fingerprint: "fingerprint-for-approved-content",
  });
});

test("comment store renames only comments tied to the same reviewer identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-reviewer-rename-"));
  const commentsPath = join(dir, "page.comments.md");
  const sourcePath = join(dir, "page.html");
  const store = createCommentStore({ commentsPath, sourcePath });

  const first = store.add({
    author: "Clear Harbor",
    authorRole: "visitor",
    reviewerId: "r_first",
    quote: "",
    body: "First reviewer comment.",
  });
  const sameNameOtherReviewer = store.add({
    author: "Clear Harbor",
    authorRole: "visitor",
    reviewerId: "r_second",
    quote: "",
    body: "Different reviewer comment.",
  });
  const sameReviewerOwnerRole = store.add({
    author: "Chekos",
    authorRole: "owner",
    reviewerId: "r_first",
    quote: "",
    body: "Owner comment should keep owner semantics.",
  });
  const legacy = store.add({
    author: "Clear Harbor",
    authorRole: "visitor",
    quote: "",
    body: "Legacy comment without reviewer metadata.",
  });

  const changed = store.renameReviewer({
    reviewerId: "r_first",
    authorRole: "visitor",
    author: "chekos",
  });

  assert.deepEqual(changed.map((comment) => comment.id), [first.id]);
  assert.equal(store.all().find((comment) => comment.id === first.id).author, "chekos");
  assert.equal(store.all().find((comment) => comment.id === sameNameOtherReviewer.id).author, "Clear Harbor");
  assert.equal(store.all().find((comment) => comment.id === sameReviewerOwnerRole.id).author, "Chekos");
  assert.equal(store.all().find((comment) => comment.id === legacy.id).author, "Clear Harbor");

  const markdown = readFileSync(commentsPath, "utf8");
  assert.match(markdown, /## chekos at /);
  assert.match(markdown, /reviewer: `r_first`/);
  assert.match(markdown, /## Clear Harbor at /);
  assert.match(markdown, /Legacy comment without reviewer metadata\./);

  const restored = loadCommentsFromMarkdown(commentsPath);
  assert.equal(restored.find((comment) => comment.id === first.id).author, "chekos");
  assert.equal(restored.find((comment) => comment.id === sameNameOtherReviewer.id).author, "Clear Harbor");
  assert.equal(restored.find((comment) => comment.id === legacy.id).reviewerId, undefined);
});

test("renderCommentsMarkdown handles an empty comment list", () => {
  const markdown = renderCommentsMarkdown({ comments: [], sourcePath: "/tmp/example.html" });
  assert.match(markdown, /_No comments yet\._/);
});
