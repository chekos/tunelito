#!/usr/bin/env node

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

console.log(`# Tunelito Session Context

Workspace: ${cwd}

Read first:
- AGENTS.md
- CLAUDE.md
- docs/agents/START_HERE.md
- docs/agents/QUALITY_GATES.md

Core commands:
- npm run check
- npm run agent:check
- npm test
- npm run ci

Protected files:
- *.comments.md
- .env*
- .claude/settings.local.json
- .git/
- node_modules/
- files.zip

Before shipping, run npm run ci. For package changes, also perform the tarball install smoke in docs/agents/RELEASE_PLAYBOOK.md.
`);
