# DEA over HTTP (remote MCP)

`dea serve --http` serves DEA to AI apps over **Streamable HTTP** (the MCP HTTP transport), so an app does not have to
start DEA itself. Two endpoints, one server:

| URL | What it serves |
|---|---|
| `http://127.0.0.1:7341/mcp` | DEA's tools: `decode_design`, `decode_code`, `decode_api`, `investigate`, `browse`, `interact`, `submit`, … |
| `http://127.0.0.1:7341/hub` | DEA Hub: the apps you connected (`dea hub add` / `dea hub connect`), with the permissions of the token's client |

## Start it

```bash
dea serve --http                    # 127.0.0.1:7341, token for client "remote"
dea serve --http --client cursor    # the token speaks for "cursor": its DEA Hub permissions and history apply
dea serve --http --port 8080
```

The first start prints a token **once**:

```text
DEA is serving over HTTP (Streamable HTTP, MCP)
  DEA tools  http://127.0.0.1:7341/mcp
  DEA Hub    http://127.0.0.1:7341/hub   (apps and permissions of client "remote"; ...)

New token for "remote" (shown once; only its hash is saved in ~/.dea/remote-tokens.json):
  dea_7Jq...
```

Without the package installed globally: `npx -y dea-mcp --http` does the same (coming soon, once published).

## Security

- **Every request needs `Authorization: Bearer <token>`**, health check included. No token, a wrong token or a revoked
  token gets `401`.
- Only a SHA-256 hash of each token is stored (`~/.dea/remote-tokens.json`, file mode 600). Lost a token? Make a new one:
  `dea token --client remote` (the old one stops working at once). `dea token --list`, `dea token --revoke --client <name>`.
- **Bound to 127.0.0.1 by default**: only programs on this computer can reach it. Requests whose `Host` or `Origin` is not
  localhost are refused (`403`), so a web page cannot reach your DEA through DNS rebinding.
- Same rules as stdio, because the same code runs: `.dea/policy.json` for DEA's hands (submits always ask, logins and
  payments never), DEA Hub permissions per client (`dea hub allow <client> <app> <level>`), `dea hub off <client>`,
  the auto-pause alert, and `dea hub history`.
- `--host 0.0.0.0` exposes DEA to your network. DEA prints a warning. Put it behind HTTPS (a reverse proxy) and use
  `--allowed-host your.domain` so only that name is accepted.

## One client, one set of runs and sign-ins

- **Runs are kept apart per client.** Each token's client writes its runs to `~/.dea/clients/<client>/runs`, so one AI
  app cannot list, read or overwrite another app's runs, and two clients working at the same time never share a folder.
  `dea runs` on your own machine still shows `~/.dea/runs` (the stdio and CLI runs).
- **Your browser sign-ins (`DEA_PROFILE`) are off over HTTP** unless you name the clients that may use them:

  ```bash
  DEA_PROFILE=work dea serve --http --profile-client cursor        # only "cursor" browses signed in
  dea serve --http --profile-client cursor claude                  # more than one
  ```

  Every other client gets a fresh, signed-out browser. Without `--profile-client`, DEA prints that the profile is not
  used, so a token that leaks never browses as you.
- **Hub approvals belong to one client.** An approval is tied to the client, the app, the tool and the exact arguments,
  works once and ends after ten minutes, so an approval given to one client never lets another client do the same thing.

## Slow machines: record first, extract later

`extract` has a `recordOnly` option. It does only the slow part (the reference screenshot and the site's recorded WebGL
frames), keeps it in the cache and returns. Call `extract` again with the same `url` (and the same `section` and
`referenceMs`, if you gave them) and without `recordOnly`: it reuses the recording instead of opening the site again.
This splits one long request into two short ones, useful when an AI app or a proxy cuts requests after a minute or two.
On the command line the same thing is `dea record <url>`, then `dea extract <url>`.

## Point an AI app at it

Replace `TOKEN` with your token.

**Claude Code**

```bash
claude mcp add --transport http dea http://127.0.0.1:7341/mcp --header "Authorization: Bearer TOKEN"
claude mcp add --transport http dea-hub http://127.0.0.1:7341/hub --header "Authorization: Bearer TOKEN"
```

**Cursor** (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "dea": { "url": "http://127.0.0.1:7341/mcp", "headers": { "Authorization": "Bearer TOKEN" } },
    "dea-hub": { "url": "http://127.0.0.1:7341/hub", "headers": { "Authorization": "Bearer TOKEN" } }
  }
}
```

**VS Code** (`.vscode/mcp.json`; VS Code asks for the token once and keeps it in its secret storage)

```json
{
  "inputs": [{ "type": "promptString", "id": "dea-token", "description": "DEA token", "password": true }],
  "servers": {
    "dea": { "type": "http", "url": "http://127.0.0.1:7341/mcp", "headers": { "Authorization": "Bearer ${input:dea-token}" } }
  }
}
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.dea]
url = "http://127.0.0.1:7341/mcp"
bearer_token_env_var = "DEA_TOKEN"
```

**Any MCP client library**

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7341/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.DEA_TOKEN}` } },
  }),
);
console.log(await client.callTool({ name: 'detect_stack', arguments: { url: 'https://gsap.com' } }));
```

**curl** (to see it work)

```bash
curl -s http://127.0.0.1:7341/mcp \
  -H "Authorization: Bearer $DEA_TOKEN" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"detect_stack","arguments":{"url":"https://threejs.org"}}}'
```

PowerShell:

```powershell
$h = @{ Authorization = "Bearer $env:DEA_TOKEN"; Accept = "application/json, text/event-stream"; "mcp-protocol-version" = "2025-06-18" }
Invoke-RestMethod http://127.0.0.1:7341/mcp -Method Post -Headers $h -ContentType 'application/json' `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"detect_stack","arguments":{"url":"https://threejs.org"}}}'
```

## Notes

- Each request is served statelessly (the 2025 Streamable HTTP "stateless" mode, plus the 2026 per-request mode).
  DEA's browser for `browse` / `interact` stays open between requests, one per client.
- Long tools (`decode_code` takes 1–4 minutes) keep the HTTP request open until they finish; for long work prefer
  `investigate` + `get_run_status`.
