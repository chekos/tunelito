# Backlog Drain Report

Started: 2026-06-16 Pacific / 2026-06-17 UTC

## Baseline

- Branch: `codex/backlog-drain-issues` from up-to-date `origin/main`.
- Open GitHub issues at start: #27, #41, #44.
- Priority order: #27 major, #44 major, #41 minor. No open issue had a critical label.
- Binding instructions read: `AGENTS.md`, `CLAUDE.md`, `docs/agents/START_HERE.md`, `docs/agents/IDEA_TO_RELEASE.md`, `docs/agents/WORKFLOW.md`, `docs/agents/QUALITY_GATES.md`, `docs/agents/ARCHITECTURE.md`, `docs/agents/SECURITY_REVIEW.md`, `docs/agents/EXAMPLE_FIXTURES.md`.
- `STRATEGY.md` was requested as binding input but is not present in the repository file list or tracked paths discovered by `rg --files`.

## Baseline Verification

- `npm run check` passed.
- `npm test` passed: 112 tests.
- `npm run ci` passed, including check, agent config, docs check, tests, smoke check, and package smoke check.

## Issue #27: Add owner approval workflow for visitor comments

Status: committed and closed in `5721013`.

Priority: major, because it changes which reviewer comments can become local-agent instructions.

Decision:

- Implemented a one-way `Approve for agent` workflow for owner-keyed sessions.
- Stored approval as metadata on the original visitor comment instead of creating cross-comment relationships or separate approval comments.
- Treated owner-approved visitor comments as actionable for existing `owner` and `owner-or-mention` agent policies.
- Bound approval to the comment fingerprint so changed comment content needs re-approval.
- Kept approval persistent-only; `--live` rejects approval because there is no durable agent inbox.
- Did not add revocation in this slice. That is a deliberate scope cut; the issue asked for approval and listed revocation as conditional.

What changed:

- `src/comments.js`: owner approval metadata, atomic comment update support, markdown render/restore.
- `src/server.js`: owner-only `approve-comment` WebSocket event, `comment-updated` broadcast, forged approval stripping on comment creation, live-mode rejection.
- `src/agent-worker.js`: policy matching for owner-approved comments, prompt metadata, updated owner-policy descriptions.
- `src/client.js`: owner-only approval button, approved badge, mobile touch target and overflow fixes.
- Tests and docs updated across server/comment/agent-worker coverage, README, Mintlify docs, agent playbooks, and changelog.

Verification:

- `npm run check` passed.
- `node --test test/comments.test.js test/agent-worker.test.js test/server.test.js test/cli.test.js` passed: 92 tests.
- `npm run docs:check` passed.
- `npm run agent:check` passed.
- Security/persistence adversarial subagent found no blockers.
- UI/HIG adversarial subagent flagged mobile touch-target and long-owner-name overflow issues; both were fixed.
- Browser fixture check used `examples/dashboard-spa.html` with temp comments files outside the repo. Desktop and mobile owner-panel checks passed: approval click updates the card, hides the button, writes markdown context, preserves focus outline, avoids horizontal overflow, hides the launcher over an open mobile bottom sheet, and gives the approval button a 44px mobile touch target.
- Long owner-name browser check passed: approval label `clientWidth` and `scrollWidth` both measured 348px on a 390px viewport.
- A dedicated `visual-qa-hig` workflow was requested but no repo or installed workflow by that name exists; used the repo fixture/browser pass from `docs/agents/EXAMPLE_FIXTURES.md` plus the UI adversarial subagent instead.

## Issue #44: Make reviewer names feel assigned and support renaming past comments

Status: implemented and verified; included in the issue #44 commit.

Priority: major, because it changes visible reviewer identity behavior and persisted comment metadata.

Decision:

- Replaced `Guest <code>` with short friendly adjective+noun names. The style is professional rather than cute.
- Replaced the always-visible name textbox with an assigned identity card: `Assigned as`, the current name, and an explicit `Edit` button.
- Added stable `reviewerId` metadata for new comments. Visitor sessions persist their reviewer ID in browser storage; owner sessions use the server owner session ID.
- Made the server stamp reviewer ID and author role from the WebSocket peer, not from user-supplied comment or rename payloads.
- Renames update prior comments only when both `reviewerId` and `authorRole` match. This preserves owner semantics and prevents two reviewers with the same display name from rewriting each other.
- For persistent sessions, renames rewrite the comments markdown. For `--live`, renames update the in-memory comment store and broadcast `comment-updated` events only.
- Existing comments without `reviewerId` metadata are left unchanged during rename. I chose this over string matching because the issue explicitly required stable identity rather than display-name matching.
- Added a pending rename queue so a rename made during reconnect, or recovered from local storage after reload, is flushed to the server and acknowledged before being cleared.

What changed:

- `src/client.js`: friendly assigned names, identity card/edit form, reviewer ID persistence, `rename-reviewer` sending, reconnect/reload rename recovery, wrapped long identity/comment metadata, mobile 44px identity controls, focus restoration after save/cancel/Escape.
- `src/comments.js`: `reviewerId` normalization and metadata persistence, visible reviewer context, store-level `renameReviewer` for persistent and memory stores.
- `src/server.js`: reviewer ID handshake, server-stamped comment reviewer IDs, `rename-reviewer` WebSocket event, `reviewer-renamed` acknowledgment, `comment-updated` broadcasts.
- Tests: comment-store rename coverage, persistent WebSocket rename coverage, live-mode rename coverage, same-name collision coverage, owner/visitor role preservation, source HTML preservation, client bundle assertions for assigned UI and pending rename behavior.
- Docs: README, Mintlify docs, architecture and security playbooks, and changelog updated for friendly assigned names, stable reviewer metadata, legacy fallback behavior, and reviewer-ID-not-auth caveat.

Verification:

- `npm run check` passed.
- `node --test test/comments.test.js test/server.test.js` passed: 33 tests.
- `npm run docs:check` passed.
- `npm run ci` passed: check, agent config, docs check, 117 tests, smoke check, and package smoke check.
- Security/persistence adversarial subagent initially found a disconnected/reload rename persistence edge; fixed with pending rename recovery. Re-check was clean.
- UI/HIG adversarial subagent initially found mobile touch-target, focus-return, and long-name overflow issues; all were fixed. Re-check was clean.
- Browser fixture check used `examples/dashboard-spa.html` with temp comments files outside the repo. Desktop checks passed for assigned name display, hidden edit form, page note creation, reload recovery, UI rename, focus returning to `Edit`, and markdown rewrite.
- Mobile browser check at 390x844 passed for long unbroken names, comment metadata wrapping, no horizontal overflow, hidden launcher while panel is open, and 44px identity edit/save/cancel targets.
- A dedicated `visual-qa-hig` workflow was requested but no repo or installed workflow by that name exists; used the repo fixture/browser pass from `docs/agents/EXAMPLE_FIXTURES.md` plus the UI adversarial subagent instead.

## Issue #41: Explore optional laser pointer mode for live HTML reviews

Status: implemented and verified; included in the issue #41 commit.

Priority: minor, because it is default-off ephemeral review UI and does not change comment persistence or agent behavior.

Decision:

- Implemented a default-off `Pointer` control in the injected Tunelito panel.
- Chose a red halo around the normal cursor instead of hiding the native cursor. This keeps reviewed pages usable and avoids browser-specific custom cursor behavior.
- Exposed the control only on fine-pointer devices. Touch-only/mobile devices hide the control.
- Made the pointer local in any session and broadcast it to peers only in `--live`.
- Treated pointer events as ephemeral live UI: no markdown persistence, no hidden metadata, and no source HTML edits.
- Kept all overlays `pointer-events: none` so links, text selection, forms, and Tunelito controls continue to work.

What changed:

- `src/client.js`: pointer toggle, local laser overlay, peer laser overlay, fine-pointer gating, pointer down/up pressed state, live broadcast through the existing live-event path, peer cleanup on disconnect.
- `test/server.test.js`: client-bundle assertions for pointer UI/overlay invariants and live relay coverage proving `laser-pointer` events stay in the ephemeral live path.
- Docs: README, Mintlify docs, architecture/security playbooks, and changelog updated for the selected pointer scope.

Verification:

- `npm run check` passed.
- `node --test test/server.test.js` passed: 19 tests.
- `npm run docs:check` passed.
- `npm run ci` passed: check, agent config, docs check, 117 tests, smoke check, and package smoke check.
- Browser fixture check used `examples/slide-deck.html` in `--live` with two browser contexts. Pointer was off by default, visible after toggle, followed cursor movement, rendered on a peer as an ephemeral live event, and used `pointer-events: none`.
- The same browser check confirmed page notes still worked while pointer mode was enabled, the source HTML was unchanged, and no live comments markdown file was written.
- Touch-only browser emulation with `hasTouch: true` hid the pointer control and avoided horizontal overflow at 390x844.
- UI/HIG adversarial subagent found no blockers. Security/persistence adversarial subagent found only this report entry was stale; implementation re-check was otherwise clean.
- A dedicated `visual-qa-hig` workflow was requested but no repo or installed workflow by that name exists; used the repo fixture/browser pass from `docs/agents/EXAMPLE_FIXTURES.md` plus the UI adversarial subagent instead.
