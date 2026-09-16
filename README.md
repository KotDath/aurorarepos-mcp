# aurorarepos-mcp

Unofficial local TypeScript MCP server for <https://aurorarepos.ru/>.
Stages 0–2 are implemented: observed API contract, SDK v2 stdio scaffold and
anonymous read-only tools. No account login, uploads, publication, deletion,
package installation or binary downloads.

## Tools

| Tool | Purpose | Main arguments |
| --- | --- | --- |
| `search_apps` | Search/filter/paginate public catalog | `query`, `aurora_version`, `category_id`, `author_id`, `sort`, `page`, `page_size` |
| `get_app` | Details, plain text, screenshots and RPM metadata | `slug`, `aurora_version` |
| `get_app_versions` | Public history/release notes and RPM metadata | `slug`, `aurora_version`, `page`, `page_size` |
| `list_categories` | Category IDs/names for search | `aurora_version` |
| `list_systems` | Available OS versions and website IDs | none |
| `list_author_apps` | Public apps by author, locally paginated | `author_id`, `page`, `page_size` |

`aurora_version` is the OS major version **4 or 5** (default **5**), not the
website's system ID. Pagination defaults to page 1 / 10 items, maximum 20
items per page. Sort: `newest` (default), `popular`, `rating`, `name`.
Get slugs and author IDs from search/details. Arguments reject unknown keys.

Each successful tool returns schema-validated `structuredContent` and a
matching JSON text block. Failures use `isError: true` and a sanitized error
code/message. Historical versions are only the history returned by the public
app card, filtered to the selected OS, not all developer drafts/releases.

Example calls:

```json
{"name":"search_apps","arguments":{"query":"timer","aurora_version":5,"page_size":5}}
{"name":"get_app","arguments":{"slug":"minidoro","aurora_version":5}}
{"name":"list_systems","arguments":{}}
```

## Run/connect locally

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/index.js
```

Configure a stdio-capable MCP host to launch `node` with the **absolute** path
to `dist/index.js`. Example shape (adapt to your host's configuration format):

```json
{
  "mcpServers": {
    "aurorarepos": {
      "command": "node",
      "args": ["/home/kotdath/omp/personal/ai/aurorarepos-mcp/dist/index.js"]
    }
  }
}
```

No API key, password, cookies or environment variables are needed. Use an
absolute `node` executable path as well if your host does not inherit PATH.
The CLI supports `--help` / `--version` on stderr; normal startup emits no
non-protocol stdout. This package remains private until release preparation.

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

Inspector CLI examples:

```sh
pnpm dlx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
pnpm dlx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call --tool-name list_systems
```

`pnpm check` runs lint, typecheck, build, mocked HTTP/service/protocol tests
and real subprocess stdio handshakes (legacy + automatic negotiation). It
does not access Aurora Repos. CI runs the same checks on Node 22 and 24.

Explicit live smoke test, **accesses the website** using public read requests:

```sh
pnpm smoke:live
```

It checks all six tools, validates outputs and prints counts, not raw data.

## Safety/limits

- Fixed `https://aurorarepos.ru` origin and public endpoints only. Redirects
  are rejected; no arbitrary URL fetching or paginator-URL following.
- Some public reads use POST and require guest CSRF. Guest cookies/token
  are established internally, kept in memory and never logged or returned.
- 15-second per-request deadline (including queue wait), 2 MiB body limit,
  max concurrency 2, starts spaced at least 250 ms; bounded pending queue.
- Incoming stdio messages are limited to 64 KiB.
- One retry for transient GET failures; respect long Retry-After by returning
  a rate-limit error instead of retrying early. POST only refreshes/retries
  once on a rejected CSRF session (419), not on ambiguous network failures.
- HTML is converted to bounded plain text. Scripts/styles, hidden inputs,
  link targets, upstream token/contact fields and unknown fields are omitted.
  Website text is still **untrusted data**, not model instructions.
- Package/screenshot links are restricted to the website origin and expected
  path prefixes. They are metadata only, not fetched or installed.

## Layout

```text
src/index.ts           stdio lifecycle
src/server.ts          MCP factory
src/tools/             schemas/registration and safe result formatting
src/aurora/client.ts   fixed endpoints, guest cookies/CSRF, bounded HTTP
src/aurora/gate.ts     rate/concurrency/cancellation
src/aurora/service.ts  API parsing and public operations
src/aurora/schemas.ts  runtime input/upstream/output schemas
src/aurora/normalize.ts allowlisted fields, HTML and URL normalization
tests/                 synthetic fixtures and HTTP/service/protocol tests
scripts/live-smoke.ts  opt-in public live check
```

See [observed API contract](docs/api-contract.md) and
[implementation milestones](docs/implementation-plan.md).
The website's internal API may change. This project is unofficial.
