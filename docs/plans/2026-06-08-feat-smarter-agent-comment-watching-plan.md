---
title: "feat: Add smarter agent comment watching"
type: feat
status: active
date: 2026-06-08
origin: docs/brainstorms/2026-06-08-smarter-agent-comment-watching-brainstorm.md
---

# feat: Add Smarter Agent Comment Watching

Add explicit local agent queue policies and wake the worker when the persistent comments inbox changes on disk. This carries forward Approach A from the brainstorm: watch the markdown inbox, keep interval polling as fallback, and allow owner and mention based filtering without changing the comment UI or approval model.

Cross-comment approval is intentionally deferred to GitHub issue [#27](https://github.com/chekos/tunelito/issues/27).

## Acceptance Criteria

- [x] `--agent-policy all|mention|owner|owner-or-mention` is parsed, validated, and passed to the worker.
- [x] Default behavior remains compatible with today's `all` policy and `--agent-trigger all`.
- [x] `--agent-trigger <txt>` continues to work as the marker for legacy trigger filtering and mention policies.
- [x] Owner policy matching uses `authorRole: "owner"`, not display names.
- [x] `mention` and `owner-or-mention` require an explicit non-`all` trigger marker.
- [x] The worker watches the comments markdown inbox path and wakes promptly on create/change/rename events.
- [x] The existing polling interval remains as a fallback.
- [x] The worker does not watch or edit source HTML, the comments inbox, or the resolution ledger beyond existing state writes.
- [x] README and Mintlify docs explain trusted, owner-only, mention-only, and owner-or-mention workflows.
- [x] Tests cover CLI parsing, policy filtering, comments-file wakeups, and docs/check gates.

## Implementation Notes

- Extend `src/agent-worker.js` with `DEFAULT_AGENT_POLICY`, policy validation, queue matching, prompt context, and comments-path directory watching.
- Keep `commentMatchesTrigger` for compatibility, but add a policy-level matcher so combinations remain explicit and easy to extend.
- Watch the parent directory of `commentsPath` instead of the file itself because Tunelito writes markdown atomically through `<commentsPath>.tmp` and rename.
- Filter watch events to the comments file or its temp file when filenames are available; wake on filename-less events because some platforms omit them.
- Keep watcher failures non-fatal and rely on the interval fallback.

## Files

- `src/agent-worker.js`
- `bin/tunelito.js`
- `test/agent-worker.test.js`
- `test/cli.test.js`
- `README.md`
- `docs-site/agent-worker.mdx`
- `docs-site/cli.mdx`
- `docs-site/comments.mdx`
- `CHANGELOG.md`

## Verification

- [x] `npm run check`
- [x] `node --test test/agent-worker.test.js test/cli.test.js`
- [x] `npm run agent:check`
- [x] `npm run docs:check`
- [x] `npm run ci`
