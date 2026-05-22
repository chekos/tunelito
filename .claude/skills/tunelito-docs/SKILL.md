---
name: tunelito-docs
description: Update or review Tunelito documentation. Use when README, changelog, release docs, examples, security docs, or agent playbooks need to stay in sync with behavior.
allowed-tools: Read, Grep, Glob, Bash
---

## Documentation Map

- `README.md`: user-facing install, start, CLI, limits.
- `CHANGELOG.md`: versioned user-visible changes.
- `SECURITY.md`: security model and reporting.
- `docs/RELEASING.md`: public release process.
- `docs/agents/`: agent operating playbooks.
- `examples/README.md`: example page guidance.

## Instructions

1. Identify the behavior or process that changed.
2. Update the narrowest docs that users or agents will actually read.
3. Keep CLI output examples synchronized with `bin/tunelito.js`.
4. Keep release/version examples synchronized with `package.json`.
5. Avoid marketing fluff; document how to succeed and what can go wrong.
6. Run `npm run agent:check` for agent-doc/config changes and `npm run ci` before shipping.
