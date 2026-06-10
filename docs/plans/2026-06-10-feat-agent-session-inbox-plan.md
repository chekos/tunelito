---
title: "feat: Add active-agent inbox watching"
type: feat
status: active
date: 2026-06-10
origin: user request for agent-native Tunelito use from inside Claude Code or Codex sessions
---

# feat: Add Active-Agent Inbox Watching

Tunelito already supports responsive comment watching when it owns a spawned worker through `--agent`. This feature gives the same native watcher, policy, continuation, and ledger behavior to the current agent session without spawning a nested agent.

## Acceptance Criteria

- [x] `tunelito inbox next <target>` claims pending actionable comments and prints a prompt for the current agent.
- [x] `tunelito inbox watch <target>` waits for the next actionable comment, claims it, prints a prompt, and exits.
- [x] `tunelito inbox record <target>` records the current agent's result in `.tunelito/agent/state.json`.
- [x] Inbox commands reuse existing comment parsing, owner/mention policies, max-attempts, max-passes, continuation context, and terminal statuses.
- [x] Claims use expiring leases so two active sessions or workers do not duplicate a fresh comment.
- [x] `--agent-session` starts a normal persistent Tunelito review session, prints active-agent inbox commands, and writes `.tunelito/session.json` without spawning a child agent.
- [x] `--agent-session` is rejected with `--live` and cannot be combined with `--agent`.
- [x] Docs and the bundled skill explain when to use active-agent inbox mode versus the spawned `--agent` worker.

## Implementation Notes

- Extend `src/agent-worker.js` rather than adding a second ledger implementation.
- Keep `.tunelito/agent/state.json` as the single resolution ledger for spawned and active-agent workflows.
- Keep `*.comments.md` append-only from the agent perspective; active agents record outcomes through the CLI instead of editing the ledger manually.
- Treat `--agent-session` as the safer default for "I am already in an agent session; serve this and watch comments."

## Files

- `src/agent-worker.js`
- `bin/tunelito.js`
- `test/agent-worker.test.js`
- `test/cli.test.js`
- `README.md`
- `docs-site/*.mdx`
- `docs-site/skill.md`
- `docs/agents/ARCHITECTURE.md`
- `docs/agents/SECURITY_REVIEW.md`
- `CHANGELOG.md`

## Verification

- [x] `npm run check`
- [x] `node --test test/agent-worker.test.js test/cli.test.js`
- [x] `npm run agent:check`
- [x] `npm run docs:check`
- [x] `npm test`
- [x] `npm run smoke:check`
- [x] `npm run ci`
- [x] `npm run pack:check`
