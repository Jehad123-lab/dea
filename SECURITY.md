# Security policy

## Supported versions

DEA is pre-1.0. Security fixes land on `main` and in the next release.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repository). Include what you ran, what happened, and the run folder
if it helps (remove anything private first). You will get an answer within 7 days.

## What DEA does to stay safe

- **Read-only by default.** Decoders load and scroll pages; they never submit forms. Hands (`dea session`, MCP
  `interact`/`submit`) follow `.dea/policy.json`: submits always ask, logins and payments are never automated.
- **No secrets on disk.** Cookies, `Authorization` headers, tokens in URLs and bodies, and password fields are
  redacted from HAR files, reports and logs before they are written.
- **Remote server is locked down.** `dea serve --http` binds to `127.0.0.1` and requires a bearer token on every
  request; the token is stored under `~/.dea` with user-only permissions.
- **DEA Hub** keeps connected apps' credentials encrypted (AES-256-GCM, key in a user-only file or `$DEA_HUB_KEY`), applies per-app × per-client
  permissions, logs every call, and has a kill switch (`dea hub off`).
- **Live debug** (`dea trace --break …`) pauses only the browser DEA started, never your own browser profile.

## Scope

In scope: the `dea` CLI, the `dea-mcp` server, `@dea/core`. Out of scope: the websites DEA reads, and third-party MCP
servers you connect through Hub.
