# Agent Start Here

Tunelito is a small package with a deliberately high bar for agent handoffs. Your job is not only to make the requested change; it is to preserve the repo as a reliable workspace for the next agent.

## What Tunelito Does

Tunelito serves one local HTML file, injects a same-origin review client at response time, syncs live comments over WebSocket, writes comments to markdown, reloads clients when the source file changes, and can expose the local server through a temporary Cloudflare Tunnel.

The source HTML is the user's document. Do not mutate it as part of the annotation layer.

## First Five Minutes

```bash
git status -sb
rg --files -g '!*node_modules*' -g '!*.comments.md'
sed -n '1,220p' README.md
sed -n '1,220p' docs/agents/ARCHITECTURE.md
npm run check
```

If the tree is dirty, identify which changes are yours before editing. Preserve unrelated user or agent work.

## Source Map

- `bin/tunelito.js`: CLI argument parsing, startup output, tunnel orchestration.
- `src/server.js`: HTTP server, file serving, review-key auth, WebSocket upgrade.
- `src/client.js`: injected browser UI and live annotation behavior.
- `src/comments.js`: markdown persistence and comment restoration.
- `src/inject.js`: HTML injection and CSP meta handling.
- `src/ws.js`: minimal WebSocket hub.
- `src/tunnel.js`: Cloudflare Tunnel process management.
- `test/`: Node test runner coverage.
- `.claude/`: Claude Code hooks, project skills, and subagents.
- `docs/agents/SKILLS.md`: catalog of project skills and validation policy.

## Default Change Loop

1. Understand the request and relevant files.
2. Make the smallest coherent change.
3. Update tests for behavior changes.
4. Update README/CHANGELOG/playbooks for user-facing or process-facing changes.
5. Run targeted verification.
6. Run `npm run ci` before commit or handoff.
7. Summarize what changed, what passed, and any residual risk.

## Agent-Native Principle

The repository should encode the team's process in files. If an agent learns something non-obvious, add or improve a playbook instead of leaving it only in chat history.
