# DEA Hub

The Hub is the layer around a decode: free web search, and connections to the apps you work in. It is built so that an AI
app can use it without ever holding your tokens, and so that nothing changes anywhere without a record.

## Search and read (free, no keys)

```
dea search "webgl instancing" [--source mdn,npm] [--limit 8] [--fresh] [--json]
dea read https://example.org/page [--max 12000] [--links] [--fresh] [--json]
```

Sources: DuckDuckGo HTML results; MDN, npm, GitHub repository search and Stack Overflow for programming questions;
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

## Connectors

A connector is an app the Hub can call. Two kinds, one set of rules:

1. **MCP servers**: any server you configure (`dea hub add name -- command args`, or `dea hub connect <app>` for the official
   remote ones). DEA lists its tools, calls them, and re-exposes them as `<app>__<tool>` through `dea hub serve` /
   `dea mcp install --hub`.
2. **Built-in connectors**: `github`, `vercel` (static deploy), `filesystem` (one folder), `http` (one base address).
   `dea hub connectors` lists their tools and scopes; `dea hub add-connector <kind> --scope key=value --token-env VAR` adds one.

`dea hub list | tools <app> | call <app> <tool> '{json}' | remove <app> | doctor [--live] | audit | mode` manage them.

### The rules every call goes through

1. **Access level** (`dea hub allow <client> <app> full|read|selected|off`): what this AI app may do with this app at all.
2. **Scope** (built-in connectors): what the connector may touch, declared when you add it: repos, projects and deploy
   folders, one folder, one base address. Outside it is refused in every mode.
3. **Permission mode** (`DEA_MODE` or `policy.json`): `restricted` refuses every change; `supervised` (default) asks you
   before each change; `delegated` lets changes run inside the scope. Looking never asks. A tool of an MCP server counts as a
   change unless the server marks it read-only.
4. **Audit**: every change writes `intent` then `done`/`failed` (or `denied`) to `~/.dea/audit.jsonl` with the time, client,
   app, tool, where it lands, mode and basis. If the line cannot be written, the change is not made.
5. **Alert**: more than N changing calls in M minutes pauses that AI app (`dea hub alert`).

### Secrets

Tokens come from an environment variable whose **name** you give (`--token-env GITHUB_TOKEN`); the value is read when a
call runs and sent only in that call's Authorization header. It is never written to `hub.json`, the history, the audit
log, evidence reports, kits, results or error messages: DEA replaces the exact value (and its URL-encoded and base64 forms)
and the common token shapes wherever text could leave. A name that does not look like a variable name (someone pasted a token
there) is refused without echoing it. DEA never asks for a password or token in a chat.

### Not in the Hub

Nothing posts, emails, publishes or buys on its own. A change happens only when a call you or an AI app you allowed makes it,
inside the scope you declared, in a mode that allows it, with a record.
