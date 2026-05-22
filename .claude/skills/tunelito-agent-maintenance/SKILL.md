---
name: tunelito-agent-maintenance
description: Maintain Tunelito's agent operating system. Use when editing AGENTS.md, CLAUDE.md, .claude hooks, .claude skills, .claude agents, or docs/agents playbooks.
allowed-tools: Read, Grep, Glob, Bash
---

## Agent Config

!`find .claude docs/agents -maxdepth 4 -type f | sort`

## Instructions

Keep the agent system coherent:

1. Use current Claude Code skill format: `SKILL.md` with YAML frontmatter and concise markdown.
2. Make side-effect workflows manual-only with `disable-model-invocation: true`.
3. Keep hooks deterministic, fast, local, and Node-only.
4. Update `docs/agents/HOOKS.md` when hook behavior changes.
5. Update `CLAUDE.md` when adding or removing project skills/subagents.
6. Run `npm run agent:check` and `npm run ci`.

Prefer adding validation to `.claude/scripts/validate-agent-config.mjs` over relying on convention.
