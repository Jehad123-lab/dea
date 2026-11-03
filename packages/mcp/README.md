# dea-mcp

The DEA MCP server: lets AI agents decode any website (stack, design, motion, WebGL shaders, code, APIs) with evidence.
Every fact is labelled **Verified**, *Inferred* or Unknown.

> Not on npm yet (coming soon). Until then run it from a clone: `node packages/mcp/bin/dea-mcp.mjs`, or
> `pnpm dea mcp install --client claude`.

```json
{ "mcpServers": { "dea": { "command": "npx", "args": ["-y", "dea-mcp"] } } }
```

Over HTTP instead of stdio:

```bash
npx -y dea-mcp --http     # http://127.0.0.1:7341/mcp (DEA tools) and /hub (DEA Hub), bearer token printed once
```

Tools: `decode_design`, `decode_code`, `decode_api`, `decode_assets`, `decode_motion`, `extract`, `trace_webgl`, `library`, `inspect_site`, `detect_stack`, `investigate`, `get_run_status`,
`report`, `list_runs`, `browse`, `interact`, `submit` (submits always ask the user first; logins and payments never).

Needs Node 22.12+ and Chrome or Edge (or `npx playwright install chromium`).
Source and docs: https://github.com/Jehad123-lab/dea. MIT licence, by Jehad Uddin.
