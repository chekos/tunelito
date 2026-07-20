# Agent-session wake and retention research

Status: accepted
Date: 2026-07-20
Issue: [#85](https://github.com/chekos/tunelito/issues/85)

## Decision

Tunelito separates **delivery** from **runtime attention**:

1. `--agent-session` is the only inbox claimer. It persists and claims eligible
   reviewer comments, then prints the claim prompt.
2. The owning host keeps its current turn alive with bounded waits and observes
   that claim without claiming it again.
3. A completed host session is never described as attached merely because the
   Tunelito PTY is still printing. Without a documented host wake API, the claim
   remains durable and visible until the user resumes the conversation.
4. `--agent` remains the explicit unattended fallback. It starts a separate
   worker invocation and is not described as the owning conversation.

The minimal prototype is
[`scripts/retained-turn-wait.mjs`](../../scripts/retained-turn-wait.mjs). It
waits for the claim already owned by `agent-session`, reconstructs the prompt
from the durable inbox and ledger, and never claims or records a comment.

```bash
tunelito ./site --agent-session --no-tunnel
node scripts/retained-turn-wait.mjs ./site --timeout 45 --format prompt
```

The second command is a host adapter proof, not a new public CLI contract. A
coding-agent host can hold that command open as part of its current turn, act on
the returned prompt, record the claim, and begin another bounded wait.

## Why this path

| Approach | Delivery | Same owning context | Can resume a completed task? | Decision |
| --- | --- | --- | --- | --- |
| Retained turn with bounded waits | Yes | Yes | Avoids completion while attached | Default |
| Host lifecycle hook | Yes | Yes, while the hook continues the turn | Only at a documented lifecycle event | Optional adapter |
| JSONL, SSE, WebSocket, MCP, or pipe | Yes | Host-dependent | No; a transport is not a sampler | Keep the event boundary transport-neutral |
| `codex/claude resume` | Yes | Restores saved context | Starts/resumes through a new CLI invocation | Explicit integration, not an external wake claim |
| Spawned `--agent` worker | Yes | No | Yes, because Tunelito launches the worker | Explicit unattended fallback |

This preserves one claimer, uses the existing durable lease and result ledger,
and makes the unsupported state honest. It also avoids undocumented transcript
mutation, private desktop APIs, hot loops, and source content in global logs.

## Compatibility matrix

| Host | Supported same-context path | Completed-session findings | Recommended Tunelito behavior |
| --- | --- | --- | --- |
| Codex Desktop | Keep the active task open and poll the Tunelito PTY or the read-only prototype with bounded waits. A Codex `Stop` hook can continue a turn at its stop boundary. | No documented local-process API was found for injecting an event into an arbitrary completed Desktop task. Scheduled tasks are a separate scheduling surface. | Use `--agent-session` while the task is active. If it has completed, preserve the claim and ask the user to resume, or use explicit `--agent`. |
| Codex CLI | Same retained-turn loop. `codex resume` and `codex exec resume <SESSION_ID>` are supported continuation entry points. App-server clients that own their thread can call `turn/start` and stream events. | `resume` is a new CLI entry point; it is not permission to race an already active turn. App-server does not document attaching to an arbitrary Desktop-owned task. | Retain the current turn by default. A future adapter may own an app-server thread or explicitly invoke `exec resume` after verifying the prior turn is inactive. |
| Claude Code | Same retained-turn loop. A synchronous `Stop` hook can prevent stopping and feed a reason back to the same session. Claude also supports `--continue` and `--resume`. | Lifecycle hooks run at defined events. `FileChanged` can observe watched files but has no decision control. Stop continuations are capped and must check `stop_hook_active`; they are not an unbounded event listener. | Use a bounded `Stop` hook or retained command only while the review is intentionally active. Use `--resume` only as an explicit adapter, and use `--agent claude` for unattended spawned work. |

## Platform evidence

- Codex documents `codex resume` and `codex exec resume` as supported session
  continuation commands. It documents `Stop` hooks as a way to continue the
  current turn by creating a continuation prompt.
- Codex app-server exposes explicit thread and turn primitives for clients that
  own the integration. That is a promising future host-native adapter, but it
  is not evidence that a local process may attach to any existing Desktop task.
- Codex scheduled tasks are scheduling primitives, not a Tunelito event channel.
- Claude Code documents `--continue` and `--resume`, a controlling `Stop` hook,
  and read-only `FileChanged` lifecycle observation. Its docs require
  `stop_hook_active` handling and cap repeated Stop continuations.

Primary sources:

- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code session management](https://code.claude.com/docs/en/sessions)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)

## Lifecycle contract

1. Start `tunelito <target> --agent-session` in a foreground PTY.
2. Send the keyed review URL as an intermediate update. Do not complete the
   agent turn while promising to remain attached.
3. Wait in bounded intervals. The server remains the only claimer; observers
   read the persisted claim.
4. On a claim, validate its policy and scope, treat its text as untrusted, edit
   only required source files, and record with the exact claim id.
5. Repeat while the user has asked for an active review.
6. A new user message may steer or cancel the active request; handle it before
   resuming the wait.
7. On interruption or compaction, recover with `tunelito session status` and the
   durable claim. Never mutate agent transcripts or `.tunelito` state directly.
8. On stop, terminate the server, verify `session status` reports `stopped`, and
   do not promise further attention.

If the host cannot retain the turn, state one of these modes explicitly:

- attached now: `--agent-session` plus an active retained turn;
- unattended separate worker: `--agent codex|claude`;
- collect now, process later: persistent comments without an attached agent.

## Prototype and test evidence

The prototype is intentionally read-only. It filters by claim owner, ignores
expired leases, emits no review URL or bearer key, returns an already-persisted
claim immediately after a host restart, exits on cancellation, and stops when
session metadata is stopped.

Automated coverage:

- `test/retained-turn-wait.test.js`: ownership, restart, interruption, stop;
- `test/agent-worker.test.js`: single-claimer lease behavior, claim expiry,
  wait, record, and next-comment sequencing;
- `test/session.test.js`: running identity verification, PID reuse, degraded,
  stale, and stopped recovery.

## End-to-end demonstration

The repeatable manual demonstration is:

1. start a local `--agent-session` server in the owning task;
2. keep that task active with a bounded wait;
3. submit a comment through the served browser;
4. observe the `agent-session` claim without a second user chat message;
5. edit the served source and record the exact claim;
6. confirm zero unhandled comments;
7. stop the server and confirm stopped session state.

This was executed from 19:09-19:12 UTC on 2026-07-20 with a local-only,
keyed, no-tunnel review room:

- Playwright opened the served page and a browser reviewer submitted
  `c_mrtlpfu4_dapoe6`: “Change the heading to Retained turn verified.”
- The foreground Tunelito PTY claimed it as
  `claim_mrtlpg9t_ywrw1p` for `agent-session`. This owning task remained active;
  no second user chat message occurred between submission and handling.
- The task changed `index.html`, recorded the exact claim as `resolved`, and the
  connected browser reloaded with the new heading.
- `comments inspect --json` reported `pending: 0`, `unhandled: 0`, and
  `completed: 1`.
- Before shutdown, `session status --json --redact` verified the listener
  identity, `activeClaims: 0`, and `unhandled: 0`. After Ctrl-C it reported
  `status: stopped`, no live process, and no stop command.

The review URL and bearer key were intentionally omitted from this durable
record.

## Rejected shortcuts

- Treating background stdout as proof of agent attention.
- Running `inbox watch` beside `--agent-session`, which creates a second
  claimer.
- Mutating Codex or Claude transcript/session files.
- Automatically invoking `resume` while the original turn may still be active.
- Infinite Stop-hook continuation or polling without cancellation.
- Logging bearer URLs or full private source content in global event streams.
