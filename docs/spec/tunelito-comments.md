# Tunelito Comments Index

Tunelito stores review feedback in a human-readable Markdown sidecar named `*.comments.md`. The `tunelito-comments` index is a derived JSON view of that sidecar for agents, tests, MCP tools, and diagnostics.

The index does not replace the Markdown inbox and is not durable state. Tunelito still restores comments from hidden `tunelito-comment` metadata in the Markdown file, and source HTML files remain untouched.

## Command

```bash
tunelito comments inspect ./page.html --json
tunelito comments inspect ./site --json
tunelito comments inspect ./site --out ./custom.comments.md --json
tunelito comments inspect ./site.comments.md --json
```

For a page or folder target, Tunelito derives the default comments path the same way the review server does. A missing default comments file returns an empty successful index because the inbox has no comments yet.

When inspecting a Markdown file directly, the file must exist and look like a Tunelito comments inbox. Direct inspection has no target path, so `targetPath` is `null`.

## Shape

The top-level format is versioned:

```json
{
  "format": "tunelito-comments",
  "version": 1,
  "targetPath": "/absolute/path/to/site",
  "commentsPath": "/absolute/path/to/site.comments.md",
  "ok": true,
  "summary": {
    "total": 2,
    "page": 1,
    "site": 1,
    "owner": 1,
    "visitor": 1,
    "ownerApproved": 0
  },
  "comments": [],
  "diagnostics": []
}
```

Each indexed comment mirrors Tunelito's normalized comment model:

```json
{
  "id": "c_abc123",
  "author": "Dana",
  "authorRole": "visitor",
  "reviewerId": "r_abc123",
  "ownerApproval": null,
  "scope": "page",
  "quote": "selected text",
  "body": "Make this clearer.",
  "prefix": "before ",
  "suffix": " after",
  "path": "body > main > h1",
  "pagePath": "/index.html",
  "textStart": 42,
  "textEnd": 55,
  "created": "2026-06-17T00:00:00.000Z"
}
```

Fields that are absent in older Markdown metadata are returned as `null` or empty strings where appropriate, not omitted.

## Diagnostics

`ok` is `false` when any diagnostic has `severity: "error"`. Damaged hidden metadata is reported as a diagnostic instead of crashing.

The index relies on the same safe hidden-metadata restoration path used by the review server. Visible Markdown that looks like context or metadata does not create indexed comments.

## Schema

The JSON Schema lives at `docs/spec/tunelito-comments.schema.json`.
