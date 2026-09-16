# aurorarepos-mcp

Local TypeScript MCP server for <https://aurorarepos.ru/>. Work in progress;
the initial scope is anonymous read-only access. No login or publication.

## Development

Requires Node.js 22+ and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The server speaks stdio; a host launches it and communicates over stdin/stdout.
An idle server is normal. Diagnostics must never go to stdout.

```sh
pnpm build
pnpm dlx @modelcontextprotocol/inspector node dist/index.js
```

See [observed API contract](docs/api-contract.md) and
[implementation milestones](docs/implementation-plan.md).
The website's internal API may change. This project is unofficial.
