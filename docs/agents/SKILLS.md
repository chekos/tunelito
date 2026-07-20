# Skills

Tunelito uses project-local Claude Code skills under `.claude/skills/`. Skills are the repo's prompt-native workflows: they keep repeatable agent behavior out of chat history and close to the code.

Public user-facing setup guidance lives in `tunelito skill setup` and `docs-site/agent-setup.mdx`. Keep `tunelito skill show` as the stable source for the bundled skill body. `tunelito skill install` must remain explicit, scoped to Codex or Claude and user or project discovery paths, dry-run capable, no-overwrite by default, and byte-identical to `skill show`.

## Skill Catalog

| Skill | Use |
| --- | --- |
| `tunelito-start` | Orient or resume an agent session safely. |
| `tunelito-implement` | Implement a feature or bug fix with tests/docs. |
| `tunelito-debug` | Reproduce and fix broken behavior. |
| `tunelito-review` | Review the current diff. |
| `tunelito-security` | Work on auth, file-serving, tunnel, hook, or publishing risks. |
| `tunelito-package` | Maintain package metadata, tarball contents, CI, and install paths. |
| `tunelito-live-smoke` | Run a manual local served-page smoke test. |
| `tunelito-docs` | Update README, Mintlify docs, changelog, examples, release docs, or playbooks. |
| `tunelito-agent-maintenance` | Maintain `.claude/`, `AGENTS.md`, `CLAUDE.md`, and playbooks. |
| `tunelito-pr` | Prepare a PR-ready summary. |
| `tunelito-ship` | Manually prepare a verified commit/push. |
| `tunelito-release` | Manually prepare a package or npm release. |

## Invocation Policy

Side-effect workflows must be manual-only:

- `tunelito-live-smoke`
- `tunelito-pr`
- `tunelito-ship`
- `tunelito-release`

These skills set `disable-model-invocation: true` so Claude does not decide to run them merely because work looks ready.

## Skill Quality Rules

- Keep each `SKILL.md` concise and actionable.
- Put trigger language in `description`.
- Use standard Markdown, not XML-style tags.
- Use dynamic context injection only for small, deterministic commands.
- Add supporting files when a skill grows too large.
- Run `npm run agent:check` after editing skills.

## Validation

`.claude/scripts/validate-agent-config.mjs` checks:

- required root agent docs exist
- `.claude/settings.json` parses
- every skill has valid frontmatter and a description
- skill names match directory names
- side-effect skills are manual-only
- every subagent has matching frontmatter
- required playbooks exist
- the idea-to-release lifecycle map exists

Add new policy checks there when conventions become important enough to enforce.
