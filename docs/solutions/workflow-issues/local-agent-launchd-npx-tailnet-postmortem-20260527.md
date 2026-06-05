---
module: Tunelito Operations
date: 2026-05-27
problem_type: workflow_issue
component: tooling
symptoms:
  - "Persistent review launchd job ran node bin/tunelito.js from the repo instead of the released package path"
  - "Claude worker failed with spawn claude ENOENT under launchd"
  - "npx tunelito appeared broken when tested from inside the tunelito source package"
  - "Tailscale HTTPS Serve hung when proxying back to the Tailscale IP"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: medium
tags: [launchd, npx, package-smoke, tailscale-serve, claude-worker]
---

# Postmortem: Local Agent Launchd Job Used the Wrong Runtime Path

## Problem

The long-running review server was initially made reliable at the process level, but not at the release-path level. The `launchd` job ran the repository checkout directly with `node bin/tunelito.js`, while the review workflow should have exercised the released package entrypoint users actually run: `npx tunelito`.

At the same time, the local agent path had two operational gaps:

- `launchd` did not inherit the interactive shell environment, so it could not find the `claude` CLI.
- The default Claude provider command did not allow web tools, so a comment asking for current external links could only be partially handled.

## Environment

- Module: Tunelito Operations
- Affected components: npm package smoke, launchd user agents, Claude local worker, Tailscale Serve
- Date solved: 2026-05-27
- Runtime package verified: `tunelito@0.4.1`
- Persistent service target: a local HTML review folder

## Symptoms

- The persistent service worked, but launchd showed:

```text
/opt/homebrew/bin/node /path/to/tunelito/bin/tunelito.js ...
```

That bypassed the published package path.

- The worker saw a real comment but failed twice:

```text
Agent:   failed to run claude (spawn claude ENOENT)
```

- The comment ledger marked the comment blocked after reaching the default attempt limit:

```json
{
  "status": "blocked",
  "attempts": 2,
  "lastError": "spawn claude ENOENT"
}
```

- An early `npx` check run from the source repo failed:

```text
sh: tunelito: command not found
```

This looked like a broken published package, but was actually npm resolving from inside the same-name source package context.

- Tailscale Serve was first pointed at the Tailscale IP:

```text
https://example-device.tailnet.example/
|-- proxy http://100.x.y.z:4317
```

The HTTPS URL hung locally. Proxying to localhost fixed it.

## What Didn't Work

**Running the persistent job from the repo checkout**

- **Why it failed:** It kept the review server alive, but it did not verify the packaged CLI. A broken `bin` entry, missing packed file, or executable permission regression could still pass the local review setup.

**Testing `npx tunelito@0.4.1` from inside the `tunelito` repo**

- **Why it failed:** npm treated the current same-name package context differently. Running the same command from `/private/tmp` succeeded:

```bash
cd /private/tmp
npx --yes tunelito@0.4.1 --version
# 0.4.1
```

**Adding PATH manually without loading the user shell**

- **Why it was incomplete:** Adding `/path/to/user-bin` made `claude` discoverable, but it still did not match how the user runs tools from a real terminal. The durable approach is to run the launchd command through `zsh -lic`.

**Using Tailscale Serve with the Tailscale IP as the backend**

- **Why it failed:** Tailscale Serve is the Tailnet-facing proxy. Its backend should be a local listener. Proxying to `http://127.0.0.1:4317` produced a working HTTPS endpoint.

## Solution

### 1. Add real package execution smoke coverage

PR #10 replaced the dry-run-only package check with a real packed-tarball smoke:

- `npm pack` into a temp directory
- `npm install -g --prefix <temp-prefix> <tarball>`
- run `<temp-prefix>/bin/tunelito --version`
- run `npx --yes --package <tarball> -- tunelito --version`
- run `npm exec --yes --package <tarball> -- tunelito --version`

The script is:

```bash
npm run pack:check
```

This now runs as part of:

```bash
npm run ci
```

### 2. Run the review service from the released package path

The `launchd` job was changed to invoke the released package from a clean working directory:

```bash
cd /private/tmp && exec npx --yes tunelito@0.4.1 /path/to/review-site \
  --host 127.0.0.1 \
  --port 4317 \
  --no-tunnel \
  --no-auth \
  --out /path/to/review-site/.tunelito/comments.md \
  --agent custom \
  --agent-command 'claude -p --permission-mode acceptEdits --output-format json --allowedTools Read,Write,Edit,MultiEdit,LS,Grep,Glob,WebSearch,WebFetch --add-dir /path/to/review-site' \
  --agent-state /path/to/review-site/.tunelito/agent-state.json \
  --agent-interval 120 \
  --agent-instructions "..."
```

Important details:

- `zsh -lic` loads the user's normal shell setup.
- `/private/tmp` avoids npm's same-name source package behavior.
- `npx --yes tunelito@0.4.1` exercises the released package.
- `--agent custom` permits a provider command with the exact Claude tools needed for this workflow.

### 3. Put HTTPS at the Tailnet layer

Tunelito now binds only to localhost:

```bash
--host 127.0.0.1 --port 4317
```

Tailscale Serve exposes HTTPS inside the tailnet:

```bash
tailscale serve --bg http://127.0.0.1:4317
```

Verified status:

```json
{
  "Web": {
    "example-device.tailnet.example:443": {
      "Handlers": {
        "/": {
          "Proxy": "http://127.0.0.1:4317"
        }
      }
    }
  }
}
```

### 4. Verify the real comment loop

Verification used the actual HTTPS/WSS path:

```text
wss://example-device.tailnet.example/__tunelito/ws?tunelito_page=/review-page.html
```

The verification comment reached the worker and ended terminal:

```json
{
  "status": "ignored",
  "summary": "HTTPS verification comment only; no content change requested. Confirmed target page review-page.html and quoted text exist. Tailscale HTTPS WebSocket path reached the agent worker.",
  "filesChanged": []
}
```

The test comments were removed afterward so the review inbox stayed clean.

## Why This Works

The final architecture separates concerns:

- `launchd` keeps the local process running.
- `npx tunelito@0.4.1` proves the service uses the same released package path as users.
- `zsh -lic` gives the worker the user's normal CLI environment.
- Tailscale Serve owns HTTPS and Tailnet exposure.
- Tunelito remains local-only on `127.0.0.1`.
- The worker ledger prevents repeated handling of terminal comments.

The package smoke closes the release verification gap. A future package with a broken `bin`, missing packed file, or non-runnable CLI now fails `npm run ci` before it can be treated as release-ready.

## Prevention

- For package release confidence, never rely on `npm pack --dry-run` alone. Use `npm run pack:check`.
- Run `npx tunelito` checks from a clean directory, not from inside the `tunelito` source repo.
- Long-running demos should use the released package path unless explicitly testing local unreleased code.
- `launchd` jobs that invoke user CLIs should run through `zsh -lic` or otherwise recreate the needed shell environment.
- If comments are expected to request current external links, the agent command must allow web tools and the instructions must forbid fabricated URLs.
- For Tailscale HTTPS, bind the app to localhost and let Tailscale Serve proxy to `127.0.0.1`.
- After changing a LaunchAgent plist, use unload/load, not only `kickstart`, so launchd reloads the updated `ProgramArguments`.

## Related Issues

No related issues documented yet.
