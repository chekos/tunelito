# Security Policy

Tunelito is a local-first beta for live review sessions. It is designed for temporary collaboration on drafts, not for hosting sensitive or private production documents.

## Supported Versions

Security fixes target the latest beta on `main`.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if available for this repository. If that is not available, open an issue with a minimal description and ask for a private channel before sharing exploit details.

## Session Security Model

- Tunelito serves files from your machine and optionally exposes them through a temporary Cloudflare Tunnel.
- Shared sessions require a generated `tunelito_key` URL parameter by default. The first valid request sets a short-lived, HTTP-only cookie for the session.
- The review key is bearer access. Anyone with the full printed URL can view the page and leave comments.
- Use `--no-auth` only on a trusted network or for local-only demos.
- Comments are written to a markdown file on your machine. Review them before sharing the comments file elsewhere.
