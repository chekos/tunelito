# Editable Markdown Source Plan

Issue: [#117](https://github.com/chekos/tunelito/issues/117)

## Outcome

Add an explicit `--editable` mode that lets only the direct local owner edit a
safely served Markdown source file, save it with conflict protection, and
return to the existing rendered review flow. Public or forwarded reviewers
remain read-only.

## Boundaries

- Keep editing off by default and limited to `.md` files already reachable
  through Tunelito's serving rules.
- Treat the source-write route as a separate authorization boundary: normal
  review-key authentication, same-origin mutation, direct loopback request,
  no forwarding headers, bounded body, and fresh path validation.
- Preserve exact source text, existing file permissions, and atomic-save
  behavior.
- Require a strong base revision for every save and reject stale writes.
- Keep editor text outside comment anchoring and preserve dirty browser drafts
  across external file-change notifications.
- Keep WYSIWYG editing, remote edit links, and real-time source coauthoring out
  of this release.

## Implementation Slices

1. Add the CLI capability flag, startup guidance, and server option.
2. Add authenticated read/save routes with safe target resolution, revision
   checks, request limits, and atomic replacement.
3. Add the Markdown editor surface, keyboard/focus behavior, dirty-state reload
   coordination, and explicit stale-anchor messaging.
4. Add CLI, server, security, browser, accessibility, package, and regression
   coverage.
5. Update public and agent documentation, then carry the change through the
   feature PR, release PR, trusted npm publication, clean-consumer proof,
   maintainer global install, and BNS Marketplace skill parity.

## Verification

- Focused CLI, server, Markdown, and browser checks while developing.
- `npm run ci` before the feature PR and again on the versioned release commit.
- `npm run release:check -- <version>` and `npm run pack:check` before release.
- Published-package runtime proof from a fresh temporary directory.
- Byte-identical bundled-skill parity in the merged BNS Marketplace PR.
