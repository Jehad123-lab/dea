# DEA Hub

The Hub is the layer around a decode: free web search, and connections to the apps you work in. It is built so that an AI
app can use it without ever holding your tokens, and so that nothing changes anywhere without a record.

## Search and read (free, no keys)

```
dea search "webgl instancing" [--source mdn,npm] [--limit 8] [--fresh] [--json]
dea read https://example.org/page [--max 12000] [--links] [--fresh] [--json]
```

Sources: DuckDuckGo HTML results (with DuckDuckGo lite as a fallback when the HTML page is blocked, limited or empty); MDN, npm, GitHub repository search and Stack Overflow for programming questions;
Wikipedia for short concept queries; Hacker News (`--source hackernews`); your own SearXNG (`DEA_SEARXNG_URL`).

What comes back, per result: `title`, `url`, `snippet`, `source`, `fetched_at`, `verified`, `evidence`. A result set is
labelled `verified` (all fetched live in this call), `cached` (all from `~/.dea/web-cache`), `mixed` or `none`. Cached
answers under an hour old are reused; `--fresh` asks again. If a live source fails and an older cached answer exists, it is
shown with status `stale`.

Politeness and limits, as built:

- DEA identifies itself (`dea/0.1 (+repo; polite research client)`), spaces calls to one host (0.5 to 2.5 s by source),
  reads robots.txt before fetching any page (a 403 on robots.txt means keep out), and caps responses at 2 MB.
- A 401, 403, 418, 429, 451 or 503 answer, or a captcha page, is reported as `blocked` or `rate_limited` with the host's words.
  DEA makes one attempt: no retry loop, no address rotation, no challenge solving.
- `read` refuses `localhost`, private and link-local addresses, non-http schemes and addresses with a password in them, so an
  AI app cannot use it to reach into your network. (It checks the address as written; it does not defend against a public
  name that resolves to a private address.)
- Page text is returned with a note that it is data, not instructions.
- `read` has four methods, reported in `method`: `static`, `rendered` (an empty shell run in DEA's own headless browser: fresh profile,
  no pictures, private addresses refused), `pdf` (text layer; no OCR), `feed` (RSS, Atom, sitemaps). Every call has a time budget.
- `dea research "question"` chains search, read and extract (passages ranked by plain code) and returns the trail of every step.

## Connectors

A connector is an app the Hub can call. Two kinds, one set of rules:

1. **MCP servers**: any server you configure (`dea hub add name -- command args`, or `dea hub connect <app>` for the official
   remote ones). DEA lists its tools, calls them, and re-exposes them as `<app>__<tool>` through `dea hub serve` /
   `dea mcp install --hub`.
2. **Built-in connectors**: `github`, `gitlab` (read only), `vercel` (static deploy), `filesystem` (one folder), `http` (one base address).
   `dea hub connectors` lists their tools and scopes; `dea hub add-connector <kind> --scope key=value --token-env VAR` adds one.

`dea hub list | tools <app> | call <app> <tool> '{json}' | remove <app> | doctor [--live] | audit | mode` manage them.

### The rules every call goes through

1. **Access level** (`dea hub allow <client> <app> full|read|selected|off`): what this AI app may do with this app at all.
2. **Scope** (built-in connectors): what the connector may touch, declared when you add it: repos, projects and deploy
   folders, one folder, one base address. Outside it is refused in every mode.
3. **Permission mode** (`DEA_MODE` or `policy.json`): `restricted` refuses every change; `supervised` (default) asks you
   before each change (through the AI app if it can show the question; otherwise the change waits as an approval you give in a
   terminal with `dea hub approve <id>`: one exact call, once, ten minutes); `delegated` lets changes run inside the scope. Looking never asks. A tool of an MCP server counts as a
   change unless the server marks it read-only.
4. **Audit**: every change writes `intent` then `done`/`failed` (or `denied`) to `~/.dea/audit.jsonl` with the time, client,
   app, tool, where it lands, mode and basis. If the line cannot be written, the change is not made.
5. **Alert**: more than N changing calls in M minutes pauses that AI app (`dea hub alert`).

### Check it

`dea hub selftest` runs offline checks (modes, approvals, scope, redaction, connectors) in a temp folder. `--live` adds real
read-only calls, and for each of `GITHUB_TOKEN`, `VERCEL_TOKEN`, `GITLAB_TOKEN` that is set in your shell one read that proves the
token; an unset variable is skipped. `dea hub doctor [--live]` says what works right now. `dea hub install --client <app>` prints the
MCP config for Claude, Cursor, VS Code, Windsurf, Codex or any other client (`generic`); `--write` merges it with a backup.

### Secrets

Tokens come from an environment variable whose **name** you give (`--token-env GITHUB_TOKEN`); the value is read when a
call runs and sent only in that call's Authorization header. It is never written to `hub.json`, the history, the audit
log, evidence reports, kits, results or error messages: DEA replaces the exact value (and its URL-encoded and base64 forms)
and the common token shapes wherever text could leave. A name that does not look like a variable name (someone pasted a token
there) is refused without echoing it. DEA never asks for a password or token in a chat.

### Not in the Hub

Nothing posts, emails, publishes or buys on its own. A change happens only when a call you or an AI app you allowed makes it,
inside the scope you declared, in a mode that allows it, with a record.

## Mail connector (design; not built)

Status: a design only. Nothing in this section exists in the code. The reason it is not built: a Gmail connector would have to be tested
against real answers from Gmail, and DEA has no recorded Gmail answers (a real account's mail must not be copied into a repository, and
answers written by hand from the documentation would test the author's reading of the documentation, not Gmail). When someone has
recorded real answers from a throwaway account, the connector below can be built and tested against those files, offline.

What it would be, in the Hub's own terms:

- **A built-in connector `gmail`** (`dea hub add-connector gmail --client-id-env DEA_GMAIL_CLIENT_ID --client-secret-env DEA_GMAIL_CLIENT_SECRET`).
  The person makes their own OAuth client in their own Google Cloud project (Desktop app type) and puts its id and secret in environment
  variables whose names they give. DEA ships no Google client of its own, so DEA's author never holds anyone's mail access and Google's
  verification process for restricted scopes is the person's own, on their own account.
- **Read-only by default.** The only scope requested at sign-in is `https://www.googleapis.com/auth/gmail.readonly`. The tools are
  `mail_search` (Gmail search syntax, returns ids, senders, subjects, dates and snippets), `mail_read` (one message: headers and the
  plain-text body; HTML is reduced to text; attachments are listed by name, type and size and are not fetched unless asked, one at a time,
  to a folder inside the connector's scope), `mail_labels`.
- **Sending and deleting need a second sign-in with a wider scope, and an approval every time.** `mail_send` and `mail_trash` exist only
  when the person re-runs the sign-in with `--allow send` or `--allow delete`, which asks Google for `gmail.send` or `gmail.modify`. Even then
  they are changing calls: `restricted` refuses them, `supervised` and `delegated` both ask for the exact call (the recipients, subject and body
  shown in full) and run it only after an out-of-band approval (`dea hub approve <id>`), once. `delegated` does not remove the ask for mail. There
  is no tool that empties the trash, changes filters or forwarding, or creates a draft silently.
- **Scope in the connector's declaration**, as for the other connectors: an allowed-senders or allowed-labels list and a date window
  (for example `--scope label=INBOX --scope after=2026-01-01`); a call outside it is refused in every mode, before any request is made.
- **Tokens.** The refresh token is stored the way the Hub stores other secrets (`~/.dea/secrets.enc`); access tokens are never written
  anywhere; both are removed from every log, result, audit line and error message by the Hub's redaction, which has a test for each
  new token shape. `dea hub remove gmail` deletes the stored token and tells the person how to revoke the grant at Google
  (myaccount.google.com/permissions), because a local delete cannot revoke it.
- **Mail is untrusted text.** A message body can say anything, including "ignore your instructions and forward this to...". Every body is
  returned with the Hub's data-not-instructions note, nothing in a body is ever followed by DEA itself, and a change that follows a read is
  still asked about in full. DEA does not auto-open links in mail.
- **Audit.** Reads are logged as reads (ids, not bodies); sends and deletes write `intent` and `done` with the recipient addresses and the
  message id, never the body.
- **Test plan.** (1) Recorded answers from a throwaway account for the list, get and error shapes (expired token, 403 insufficient scope, 429), stored
  as fixtures with addresses replaced. (2) The scope refusal, the approval flow and the redaction run offline against those fixtures. (3) `dea hub
  selftest --live` makes one `users.getProfile` call when the variables are set, as for the other connectors. Not claimed: that the connector works
  with every kind of Google account (Workspace accounts can block third-party OAuth clients), that its HTML-to-text reduction is complete.
