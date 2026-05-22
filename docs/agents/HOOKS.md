# Claude Code Hooks

This repo uses project-local Claude Code hooks in `.claude/settings.json`.

Official behavior to remember:

- Hooks are shell commands run by Claude Code at lifecycle events.
- Project hook settings are shared through version control.
- `PreToolUse` can block by exiting with code `2`.
- `SessionStart` stdout is injected into context.
- Matchers restrict hooks to specific tools such as `Bash` or `Edit|Write`.

## Hook Scripts

- `.claude/hooks/session-context.mjs`: prints repo orientation at session start, resume, and compaction.
- `.claude/hooks/pre-bash-guard.mjs`: blocks destructive shell commands and common agent footguns.
- `.claude/hooks/pre-file-guard.mjs`: blocks direct edits to protected local/user-data files.
- `.claude/hooks/post-edit-check.mjs`: syntax-checks edited JavaScript hook/source files when practical.

Run:

```bash
npm run agent:check
```

That command syntax-checks hook scripts, parses `.claude/settings.json`, and runs `.claude/scripts/validate-agent-config.mjs`.

## Maintenance Rules

- Keep hooks deterministic and fast.
- Do not make hooks call network services.
- Do not require tools outside Node.js unless the requirement is documented.
- Prefer clear block messages over silent failure.
- Never use hooks to hide a failing test suite.

## When Hooks Block You

Read the error message and choose the safer path. Examples:

- Use file edit tools instead of `cat > file`.
- Use `npm install --package-lock-only` instead of direct package-lock edits.
- Use `git revert` or a focused patch instead of destructive reset/checkout commands.
- Use the release playbook instead of direct `npm publish`.
