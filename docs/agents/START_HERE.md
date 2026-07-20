# Agent Start Here

Tunelito is a small package with a deliberately high bar for agent handoffs. Your job is not only to make the requested change; it is to preserve the repo as a reliable workspace for the next agent.

## What Tunelito Does

Tunelito serves one local HTML or Markdown file, or a folder of HTML and Markdown files, injects a same-origin review client at response time, syncs live comments over WebSocket, optionally uses WebRTC data channels for `--ephemeral` collaboration, writes persistent comments to markdown, reloads clients when source files change, and can expose the local server through a temporary Cloudflare Tunnel.

The source HTML or Markdown is the user's document. Do not mutate it as part of the annotation layer.

## First Five Minutes

```bash
git status -sb
rg --files -g '!*node_modules*' -g '!*.comments.md'
sed -n '1,220p' README.md
sed -n '1,220p' docs/agents/ARCHITECTURE.md
npm run check
```

Use `node bin/tunelito.js doctor <target> --json` when local setup, comments inbox, agent ledger, port, tunnel, or auth/tunnel safety state is unclear. It is read-only and does not start a server.

If the tree is dirty, identify which changes are yours before editing. Preserve unrelated user or agent work.

## Source Map

- `bin/tunelito.js`: CLI argument parsing, startup output, tunnel orchestration.
- `src/server.js`: HTTP server, file serving, review-key auth, WebSocket upgrade, WebRTC signaling.
- `src/client.js`: injected browser UI and live annotation behavior.
- `src/comments.js`: markdown persistence and comment restoration.
- `src/agent-worker.js`: opt-in local coding-agent worker, resolution ledger, provider commands.
- `src/inject.js`: HTML injection and CSP meta handling.
- `src/ws.js`: minimal WebSocket hub.
- `src/tunnel.js`: Cloudflare Tunnel process management.
- `test/`: Node test runner coverage.
- `examples/`: HTML and Markdown review fixtures for UI, screenshot, accessibility, and regression checks; use `docs/agents/EXAMPLE_FIXTURES.md` as the canonical inventory.
- `.claude/`: Claude Code hooks, project skills, and subagents.
- `docs/agents/SKILLS.md`: catalog of project skills and validation policy.
- `docs/agents/EXAMPLE_FIXTURES.md`: repo-local fixture taxonomy and when to use each example.

## Default Change Loop

1. Understand the request and relevant files.
2. Make the smallest coherent change.
3. Update tests for behavior changes.
4. Update README/CHANGELOG/playbooks for user-facing or process-facing changes.
5. Run targeted verification.
6. Run `npm run ci` before commit or handoff.
7. Summarize what changed, what passed, and any residual risk.

For end-to-end feature, PR, package, or release work, use `docs/agents/IDEA_TO_RELEASE.md` as the lifecycle map.

For injected UI, visual, accessibility, screenshot, or browser-behavior work, use `docs/agents/EXAMPLE_FIXTURES.md` to choose the right example pages before declaring the change ready.

## Agent-Native Principle

The repository should encode the team's process in files. If an agent learns something non-obvious, add or improve a playbook instead of leaving it only in chat history.
