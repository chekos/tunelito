# Distributable Tunelito Agent Skill — Research, Proposals & Tournament

Date: 2026-06-09
Status: research + proposals (exploratory; nothing shipped)

## Goal

Design the best **distributable "how to use Tunelito" skill** — a `SKILL.md` that an *end
user's* coding agent (Claude Code, Codex, Cursor, Gemini CLI, …) loads to drive Tunelito
correctly. This is the direct analog of Stripe's `stripe-best-practices` and Cloudflare's
`wrangler` skills.

This is **not** about the internal `.claude/skills/` that help agents maintain this repo.
The artifact under design is the public skill currently drafted at `docs-site/skill.md`.

Eventual distribution (separate work): host the skill in the docs, add a `tunelito skill
show` subcommand that prints/serves it, possibly publish a `.well-known/agent-skills/`
manifest, and tell users to have their agent fetch + install it.

---

## 1. Research: how leading CLIs ship agent skills

Sourced from first-party repos/docs for Stripe, Cloudflare, Supabase, Vercel, Netlify,
Expo, Neon, GitHub CLI, Laravel Boost, plus Anthropic's official skill-authoring docs and
the `agentskills.io` standard. Full source URLs are in the session research notes.

### The format has converged on an open standard

`SKILL.md` = YAML frontmatter (`name`, `description` required) + a Markdown body. Adopted
by Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot and 30+ agents
(`agentskills.io`). Three-level **progressive disclosure**:

| Level | Content | Loaded | Cost |
| --- | --- | --- | --- |
| 1 Metadata | `name` + `description` | always | ~100 tokens/skill |
| 2 Instructions | `SKILL.md` body | when triggered | keep < 500 lines |
| 3 Resources | `references/*.md`, `scripts/`, `assets/` | only when referenced | ~unbounded |

### The `description` is a router, not marketing

Every vendor writes the description as a dense, "use when…" trigger enumeration that names
products, flags, file types, and nouns a user might say. It's the only signal used to
decide whether to load the body. Anthropic's guidance: write it **third person**, be **"a
little pushy"** (Claude under-triggers skills), include both *what it does* and *when to
use it*. API cap 1024 chars; Claude Code shows `description` + `when_to_use` truncated at
1536 chars.

Examples of the pattern:
- **Cloudflare `wrangler`**: `"…Load before running wrangler commands… Biases towards
  retrieval from Cloudflare docs over pre-trained knowledge."` — embeds *when to load* and
  the *primary behavioral bias* in the description itself.
- **Supabase**: `"Use when doing ANY task involving Supabase. Triggers: Database, Auth,
  Edge Functions… supabase-js, @supabase/ssr… RLS…"` — exhaustive keyword list.

### Thin body, depth in references — but don't over-split

- Stripe `stripe-best-practices` SKILL.md is ~40 lines; a routing table delegates to
  `references/{payments,security,billing,…}.md`.
- Cloudflare `workers-best-practices` keeps the body ~200 lines, depth in
  `references/{rules,review}.md`.
- **Supabase's lesson (postmortem):** they tried splitting into reference files and found
  **agents skipped them**, so they collapsed the critical ~100 lines back into SKILL.md and
  kept references only for genuinely supplemental depth. Takeaway: critical correctness/
  safety content belongs *in the body*; references are for the long tail.

### Wording patterns that work

- **Imperative, opinionated, single default.** "Always recommend a restricted key." No
  "you could use X, or Y, or Z."
- **Anti-pattern tables with consequences** beat bare don'ts: `Anti-pattern | Why it
  matters` → "Hardcoded secrets | Credential leak via VCS." The *consequence* is what makes
  an agent comply.
- **Named security/"Critical rules" sections**, not buried prose (Supabase found agents
  knew *how* but not *when* without an explicit checklist).
- **Retrieval-over-pre-training opener** (Cloudflare/Neon): "Your knowledge of flags may be
  stale — verify against `--help`/docs before acting." Teach the agent *how to find current
  truth*, not just the truth (which rots).
- Anthropic anti-patterns: verbosity (explaining what Claude knows), multiple-option
  paralysis, time-sensitive statements, inconsistent terminology, deeply nested refs
  (>1 hop), Windows paths, vague names (`helper`/`utils`), magic constants.

### Distribution has also converged

- **`npx skills add <owner>/<repo>`** (`vercel-labs/skills`) is the cross-agent installer
  used by Supabase, Vercel, Netlify, Expo, Neon. GitHub *is* the registry; `skills.sh` is
  discovery. Installs to `~/.claude/skills/` (global) or `.claude/skills/` (project),
  symlink by default.
- **`.well-known/agent-skills/index.json`** (RFC 8615 style, like `security.txt`) lets an
  agent auto-discover + self-install from a base URL. Supabase and Stripe (`/.well-known/
  skills/`) both serve one. Cloudflare published a discovery RFC.
- **CLI-bootstrapped install** is the newest move: Wrangler detects a running agent and
  offers to install skills; Laravel Boost ships `php artisan boost:install`; **`gh skill
  preview`** prints a skill before install. `gh skill preview` + Boost are the closest
  prior art to the planned `tunelito skill show`.
- **Plugin manifests** (`.claude-plugin/marketplace.json`, `.cursor-plugin`,
  `gemini-extension.json`) ship in parallel from one repo for multi-agent reach.

### Security notes for "CLI serves a skill the agent installs"

~40% of published community skills touch sensitive context; the spec does **not** gatekeep.
For a print-then-install flow: (a) never interpolate untrusted data into the served
SKILL.md (prompt-injection), (b) scope `allowed-tools` minimally, (c) consider a content
hash in `metadata`, (d) inspect-before-install (`gh skill preview` idiom). Tunelito's own
`--agent` trust model ("reviewer comments become local agent instructions") is the same
class of risk and should be stated plainly in the skill.

---

## 2. Tunelito grounding (authoritative fact sheet)

Pulled from `README.md`, `docs-site/cli.mdx`, `docs-site/agent-worker.mdx`, `CLAUDE.md`.
This is the fact sheet the tournament generators/judges are held to — candidates may not
invent flags or schema.

**Invocation:** `tunelito <page.html|folder> [options]` (Node 22+). Public URL via
Cloudflare Tunnel when available; `--no-tunnel` for local only.

**Key flags:** `--port`, `--host`, `--out <md>`, `--owner <name>`, `--live`,
`--agent <codex|claude|custom>`, `--agent-command`, `--agent-policy
<all|mention|owner|owner-or-mention>`, `--agent-trigger`, `--agent-instructions[-file]`,
`--agent-prompt[-file]`, `--agent-max-attempts` (2), `--agent-max-passes` (3),
`--agent-interval` (120), `--agent-state`, `--no-tunnel`, `--no-auth`, `--open`.

**Comments:** persist to `<page-or-folder>.comments.md` beside the source (or `--out`).
Folder targets share one inbox beside the folder; `page`-scoped comments show only on their
page, `site`-scoped on every page. `--live` = in-memory only, no markdown, no agent worker.
Markdown context line carries: `scope`, `page`, `path` (CSS selector), `text offset`, `id:
c_…`, and `author role: owner` when `--owner` is set.

**Agent worker (opt-in):** `--agent claude` runs `claude -p` with edit perms; `--agent
codex` runs `codex exec` workspace-write; `--agent-command` runs a shell command with the
prompt on stdin (env: `TUNELITO_AGENT_ROOT/COMMENTS/STATE`, `TUNELITO_OWNER_NAME`). Ledger
at `.tunelito/agent/state.json`, log at `.tunelito/agent/log.md`. Required JSON output:
`{comments:[{id,status,summary,filesChanged,completedTasks,remainingTasks}]}`. Statuses:
`resolved, needs_followup, no-op, ignored, blocked, stale, partial, changed_needs_review`.
Mention policies require a non-`all` trigger.

**Access model:** keyed `tunelito_key` URLs by default (bearer access; cookie set on first
valid request). `--owner` adds an owner key (a label, not stronger auth). `--no-auth` only
for local/trusted.

**Limits:** annotations need real DOM text; canvas/video/images/cross-origin iframes not
annotatable; strict CSP `<meta>` removed from served response; highlight may not reattach
after the quoted text changes (comment stays in markdown).

**Non-negotiables (CLAUDE.md):** the source HTML must remain untouched **by the annotation
system**; comments persist to markdown beside source or `--out`; public tunnels are keyed
by default; treat `--agent` as trusted-session code execution.

> **Critical nuance the skill must get right:** "source HTML untouched by the annotation
> system" means *Tunelito's serving/injection layer never rewrites the file*. It does **not**
> mean a coding agent shouldn't edit the HTML — when processing comments, editing the HTML to
> satisfy a comment is the *entire point*. A candidate that tells the agent "never edit the
> source HTML" is wrong and should lose.

---

## 3. Design axes (what candidates vary on)

1. **Scope** — operator only / inbox-reviewer only / unified lifecycle.
2. **Length & disclosure** — thin (~100 lines) + references vs. fuller single-file (~200).
3. **Tone** — neutral-factual (Netlify) vs. opinionated Never/Always (Supabase).
4. **Retrieval bias** — encode flags inline vs. "verify with `tunelito --help` first."
5. **Distribution awareness** — silent vs. teaches `tunelito skill show` / self-update.

## 4. Proposals (tournament entrants)

- **A — Thin operator (Stripe-style).** ~100 lines. Intent→command decision table for the
  common jobs (share for review, live meeting, local-only, owner, agent loop). Depth in
  `references/`.
- **B — Inbox-reviewer first.** Leans into Tunelito's differentiated value: teach an agent
  to process `*.comments.md` well when the user *didn't* pass `--agent` (parse
  scope/page/id/author role, edit the right file, the JSON status shape, multi-pass, when to
  return `no-op`/`blocked`/`ignored`).
- **C — Unified lifecycle (Cloudflare-style).** Start → share → process comments → wrap up,
  with an anti-pattern table, named safety section, and one level of `references/`.
- **D — Safety/non-negotiables-forward (Supabase-style).** Opens with the invariants and a
  Never/Always checklist; careful to encode the "edit-HTML-to-satisfy-comments is correct"
  nuance.
- **E — Retrieval-biased / self-updating (Cloudflare/Neon-style).** Opens with a staleness
  disclaimer + `tunelito --help` discovery, and teaches the `tunelito skill show` /
  `.well-known` distribution path.

## 5. Judging rubric (Anthropic checklist + skill-creator + cross-vendor)

Each candidate is scored by a 4-lens panel (0–100 each):
- **Spec/format:** valid frontmatter (name rules: ≤64 chars, lowercase/hyphen, no
  `claude`/`anthropic`; description third-person, trigger-rich, ≤1024 chars); body < 500
  lines; references ≤1 hop; consistent terminology; concrete examples; no time-sensitive
  info; progressive disclosure used well.
- **Accuracy/grounding (gated):** every flag/command/schema claim matches the fact sheet.
  Any hallucinated flag or the "never edit HTML" mistake caps the score.
- **Agent task success:** simulate realistic prompts (below) — does the skill lead to the
  correct, safe command/action?
- **Trigger + safety coverage:** description triggers on review/annotate/share-HTML, resists
  near-miss false triggers; non-negotiables covered.

**Realistic task prompts (also serve as skill-creator evals):**
1. "I've got `./index.html` and want my designer to leave feedback on a call." (→ `tunelito
   ./index.html`, share Public URL, keyed-link note)
2. "Folder `./site`; while I'm on a call, auto-apply the comments people leave." (→ `--agent
   claude`/`codex`, trust + owner-or-mention gating)
3. "Tunelito wrote `site.comments.md` — go apply the comments to the right pages." (→ inbox
   processing; **edits HTML**; respects scope/page/id; status discipline)
4. "This page has sensitive client data — review locally, don't expose it." (→ `--no-tunnel
   --open`, bearer-link warning)
5. Near-miss (should NOT trigger): "add a docstring comment to this Python function" /
   "review this PR."

## 6. Tournament results

Run via a 28-agent workflow (5 authors → 20 judges → synthesize → red-team → finalize).
Judges held to the fact sheet; accuracy was a gated lens (hard-fails subtract 18 pts each).

| Rank | Candidate | Spec | Accuracy | Task | Trigger | Hard-fails | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A — Thin operator (Stripe) | 91 | 88 | 87 | 87 | 0 | **441** |
| 2 | C — Unified lifecycle (Cloudflare) | 94 | 82 | 96 | 91 | 1 | 434 |
| 3 | D — Safety-forward (Supabase) | 87 | 88 | 87 | 82 | 1 | 414 |
| 4 | B — Inbox-reviewer first | 88 | 58 | 93 | 88 | 2 | 367 |
| 5 | E — Retrieval-biased (Neon) | 82 | 62 | 88 | 92 | 2 | 363 |

The accuracy gate did its job: B and E had the best *ideas* (inbox loop, retrieval framing)
but lost on hallucinated/mis-stated detail. The synthesizer chose **C as the base** (best
task + spec, clearest lifecycle, strongest inbox loop) and grafted A's intent→command table
and reference-deferral plus D's trigger vocabulary and affirmative "you may edit the HTML"
framing.

### Code-grounded corrections (agents read `src/`, beyond the fact sheet)

- `author role: owner` is the **first** context field, and owner headings carry a `(owner)`
  suffix (`src/comments.js:170,176-177`).
- `mention`/`owner-or-mention` with an `all` trigger is a **hard startup error**, not a
  silent no-op (`bin/tunelito.js:160-161`).
- `changed_needs_review` is **internal-only**, not a worker-emittable status
  (`src/agent-worker.js:28-29,413,672`).
- **`--no-auth` and the tunnel are orthogonal** — `--no-auth` alone still publishes an
  ungated public URL; `--no-tunnel` is what controls exposure (`bin/tunelito.js:85,122,306`).
- **`--live` changes persistence, not exposure** — still served over the tunnel + bearer key.

All verified against source. The red-team pass found **no hard accuracy failures** in the
synthesized winner and applied 2 medium + 4 low safety clarifications.

### Artifacts

- Winner: shipped as `docs-site/skill.md` (single self-contained file; the agent-worker
  long-tail is inlined — see section 7).
- All five raw candidates: `distributable-agent-skill/candidates/{A..E}.md`.

## 7. Shipped on branch `feat/distributable-skill-and-show-command`

- **Promoted the winner** to `docs-site/skill.md` as a single self-contained file: the
  `reference/agent-worker.md` long-tail was inlined as a section so `tunelito skill show`
  serves one document that pipes cleanly to a file (matches Supabase's "agents skip
  references" finding; still well under the 500-line cap).
- **`tunelito skill show`** prints the bundled skill from `docs-site/skill.md` (offline,
  version-matched). `tunelito skill` / `skill help` explains how to install; unknown
  subcommands exit non-zero. Prior art: `gh skill preview`, Laravel Boost's `boost:install`.
- **`.well-known/agent-skills/index.json`** generated from the skill by
  `scripts/build-skill-manifest.mjs` (`npm run skill:manifest`) with a sha256 digest;
  `npm run docs:check` fails if it drifts, so it cannot silently rot.
- **Folded the two safety subtleties** (`--no-auth` is not local; `--live` is not private)
  into `README.md` (Access Model) and `docs-site/sharing-safely.mdx`.
- **Tests:** `test/skill.test.js` (frontmatter, manifest sync, digest) plus skill-command
  cases in `test/cli.test.js`; `pack:check` now asserts `tunelito skill show` works from a
  globally installed tarball. Full `npm run ci` is green.

### Description optimizer result (skill-creator `run_loop.py`, 4 iterations, opus, 20 queries)

Kept the **original description** — none of the 4 LLM-proposed rewrites beat it on the
held-out test set. Every should-NOT-trigger near-miss scored 0.0 (no false triggering, the
risky mode). Should-trigger queries under-triggered (0-0.33), consistent with skill-creator's
documented bias (Claude under-consults skills for tasks it can plausibly attempt directly) and
confirmed by the fact that rewrites did not help. Per skill-creator's "don't overfit to a few
queries" guidance, the description ships as the tournament produced it.

### Follow-ups (not in this branch)

- Serving the `.well-known` manifest depends on where the Mintlify docs deploy; the file is
  committed at the canonical path and points its `url` at the GitHub raw skill so `npx skills`
  can fetch it today.
- Parallel `.cursor-plugin` / `gemini-extension.json` manifests for multi-agent reach.
