---
date: 2026-06-08
topic: smarter-agent-comment-watching
---

# Smarter Agent Comment Watching

## What We're Building

Make the local agent worker more selective and responsive when Tunelito is running with `--agent`. The worker should wake when the persistent comments markdown inbox changes, not only on the fixed interval or browser-submitted comment events, and hosts should be able to choose when comments become actionable.

This is agent-worker behavior with CLI and docs impact. It is security-sensitive because reviewer comments can become instructions to a local process that edits files.

## Current Behavior

- Browser-submitted comments emit a server `comment` event and call `agentWorker.wake("comment")`.
- The worker also polls every `--agent-interval` seconds, defaulting to 120.
- `--agent-trigger` is a plain substring filter: `all` or something like `@agent`.
- Owner identity already exists as comment metadata: `authorRole: "owner"`.
- The comments markdown file is append-only; agent status lives separately in `.tunelito/agent/state.json`.

## Acceptance Criteria

- The worker notices changes to the comments markdown inbox and wakes promptly without waiting for the full interval.
- The interval remains as a fallback for platforms or editors where file watching is unreliable.
- Existing behavior stays compatible: `--agent-trigger all` continues to process every pending persistent comment.
- Hosts can restrict actionable comments by owner metadata, mention marker, or a combined owner-or-mention policy.
- Owner matching uses `authorRole: "owner"`, not display-name text.
- The worker still never edits the comments inbox or source HTML injection layer metadata.
- Tests cover queue filtering, comments-file wakeups, CLI parsing/help, and docs updates.
- Docs clearly explain the trust boundary: enabling `--agent` lets selected reviewer comments prompt a local editing process.

## Approaches

### Approach A: File Watcher Plus Action Policy

Add a comments-file watcher with debounce and keep the existing interval as a fallback. Add a richer queue policy such as `all`, `mention`, `owner`, and `owner-or-mention`, while keeping `--agent-trigger` for the marker text.

Pros:
- Solves the responsiveness problem directly.
- Uses existing owner metadata and resolution ledger.
- Keeps the first release small and testable.

Cons:
- Does not model threaded approval of someone else's comment.
- Adds one more CLI concept unless named carefully.

Best when: we want the next release to improve daily agent sessions without redesigning comments.

### Approach B: Watch File, Keep Prompt-Only Gating

Only add comments-file watching. Continue using `--agent-trigger` plus optional `--agent-instructions` such as "Only edit owner comments."

Pros:
- Smallest implementation.
- No new CLI surface.

Cons:
- The agent still gets invoked for comments that could have been filtered locally.
- Safety relies on prompt compliance instead of deterministic queue selection.

Best when: speed matters more than explicit control.

### Approach C: Explicit Approval Workflow

Add a first-class approval model: replies, approve buttons, or comment status metadata that lets the owner approve a visitor comment and unlock it for the worker.

Pros:
- Most precise expression of "owner approved this action."
- Could become a strong review-room workflow.

Cons:
- Larger UI, server, markdown, and restoration change.
- Harder to keep markdown append-only and human-readable.
- Needs more design around comment relationships and visible IDs.

Best when: we want approval semantics as a product feature, not just an agent filter.

## Recommendation

Start with Approach A. Treat owner approval in this slice as an owner-authored action comment or an explicit mention policy, then consider Approach C later if sessions show that approving other people's comments is central.

The practical first release could add:

- `--agent-policy all|mention|owner|owner-or-mention`
- `--agent-trigger <txt>` as the marker used by `mention` policies, preserving current `all` behavior by default
- a debounced watcher on `commentsPath` that calls `wake("comments-file")`
- docs examples for trusted sessions, owner-only sessions, and mention-gated sessions

## Decisions

- Default policy remains `all` for compatibility with today's `--agent-trigger all` behavior.
- `owner-or-mention` is the recommended smarter policy for sessions where the owner wants automatic handling of their own comments while still allowing explicit tagged visitor comments.
- Policies should stay explicit and composable at the queue-filter level, so future releases can add combinations without redesigning the worker.
- Mention-based policies should use the existing `--agent-trigger` marker directly. No hidden marker is introduced; docs should recommend `--agent-trigger "@agent"`.
- The CLI flag should be named `--agent-policy` because it describes which comments can reach the worker.
- Cross-comment approval is out of scope for the first slice and is tracked in GitHub issue [#27](https://github.com/chekos/tunelito/issues/27).

## Open Questions

- None for the first implementation slice.

## Cross-Comment Approval

Owner-authored action comments mean the owner writes the actionable instruction as a new owner comment, for example "Approved: tighten the hero copy" or "@agent apply the CTA suggestion." The worker processes that owner comment because its own metadata is `authorRole: "owner"` or because it contains the configured trigger marker. This fits the current append-only markdown model.

Cross-comment approval means a visitor's existing comment becomes actionable only after the owner approves that specific comment. That requires the product to represent relationships between comments, such as "comment `c_owner` approves comment `c_visitor`," or to add a status field to the visitor comment. It likely needs UI affordances, markdown metadata changes, restoration logic, queue filtering based on related comments, and tests for revoke/edit/stale cases. This is useful, but it is a larger product feature than the first watcher-and-policy release, so it is tracked separately in GitHub issue [#27](https://github.com/chekos/tunelito/issues/27).

## Next Steps

After the policy decision, write a practical implementation plan in `docs/plans/`, then implement in small steps across `src/agent-worker.js`, `bin/tunelito.js`, tests, README, and docs-site. Verification should include `npm run agent:check`, targeted agent-worker and CLI tests, and `npm run ci` before PR handoff.
