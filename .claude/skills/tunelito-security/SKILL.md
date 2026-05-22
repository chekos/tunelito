---
name: tunelito-security
description: Audit or implement Tunelito security-sensitive changes. Use for tunnel sharing, review keys, cookies, WebSocket auth, file serving, hooks, secrets, or package publishing.
allowed-tools: Read, Grep, Glob, Bash
---

## Checklist Source

Read `docs/agents/SECURITY_REVIEW.md`.

## Instructions

For security work:

1. Name the trust boundary.
2. List allowed and denied behavior.
3. Add negative tests where possible.
4. Keep default behavior safer than opt-out behavior.
5. Document any exposure clearly in README or SECURITY.md.

For reviews, report findings first with severity and file references. For implementation, run the relevant server/security tests and `npm run ci`.
