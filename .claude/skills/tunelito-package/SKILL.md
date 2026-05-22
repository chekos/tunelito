---
name: tunelito-package
description: Maintain Tunelito npm/GitHub package quality. Use for package.json, package-lock, npm pack, GitHub install, CI workflows, release docs, or beta distribution changes.
allowed-tools: Read, Grep, Glob, Bash
---

## Package Context

!`node -e "const p=require('./package.json'); console.log(JSON.stringify({name:p.name, version:p.version, engines:p.engines, files:p.files, scripts:p.scripts}, null, 2))"`

## Instructions

Check:

1. `package.json` and `package-lock.json` versions match.
2. `bin.tunelito` points to `bin/tunelito.js`.
3. `files` includes everything linked from package docs and excludes local config.
4. `npm run ci` passes.
5. `npm pack --dry-run` contains expected files.
6. Clean tarball install works.
7. If already pushed, GitHub install works.

Do not use a `prepack` hook for mandatory checks; it can break git dependency installs. Keep checks explicit in CI and release playbooks.
