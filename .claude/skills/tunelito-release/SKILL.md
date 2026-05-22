---
name: tunelito-release
description: Prepare a Tunelito package or npm release using the release playbook and package verification.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

## Current Package

!`node -e "const p=require('./package.json'); console.log(p.name + '@' + p.version)"`
!`git status -sb`

## Instructions

Follow:

- `docs/agents/RELEASE_PLAYBOOK.md`
- `docs/RELEASING.md`

Required checks:

```bash
npm run ci
npm pack
```

Also perform a clean tarball install smoke and, after publishing, an npm `npx` smoke.

Keep `package.json`, `package-lock.json`, README examples, changelog, and release docs in sync.
