# Aurora Repos: observed public API contract

Verified anonymously on 2026-09-16 against <https://aurorarepos.ru/>.
These are the website's internal endpoints, not a promised stable public API.
The site's `/api` page still says that the section is under development.
Discovery used public frontend code and a small number of normal requests.
No authenticated, upload, publish, delete, or download requests were made.

## Public read operations

| Operation | HTTP endpoint | Parameters | Observed response |
| --- | --- | --- | --- |
| Search/catalog | `GET /api/site/app` | `page`, `pagination`, `search`, `sortable`, `system`, `id` (category), `user_id` | Laravel paginator: `data`, `current_page`, `last_page`, `total` |
| Systems | `GET /api/system/any` | none | array of `{id, label, show, ...}` |
| Categories | `GET /api/site/category/{systemId}` | system ID in path | array of `{id, label, ...}` |
| Author's applications | `GET /api/site/author/{authorId}` | author ID in path | array; application ID is `application_id`, not `id` |
| Application details/history | `POST /api/site/appitem` | JSON `{slug, system}` | `{success, data, message}`; data includes `history` and `latest_app` |

The frontend also uses `POST /api/site/oldapp` with `{slug}`. The requests
checked returned `[]`; its nonempty response contract is **unverified**.
The MCP uses the verified `appitem.history` instead. The selected/latest
release follows the requested OS, but **history mixes OS versions**: a
checked Aurora 4 card had 21 Aurora 5 and 4 Aurora 4 releases. Filter history
by numeric `system` before MCP pagination (ID 3 is shared). Public history
is not an authenticated list of drafts/releases and is not guaranteed complete.

### System identifiers are endpoint-specific

Catalog/category IDs: `1` = Aurora 5, `2` = Aurora 4.
Details requests use OS major versions: `5` or `4`, as the website URL does.
The MCP accepts `aurora_version: 4 | 5` and translates internally.
The frontend treats response ID `3` as both OS versions; this behavior is
frontend-observed, not separately live-tested. Unknown IDs are not guessed.
The catalog's textual `systems` label was inconsistent with numeric `system`
and `all_systems` in a checked response. Prefer numeric fields.

### Guest session/CSRF for public POST

Without a guest session and CSRF header, `appitem` returned HTTP **419**.
`GET /` supplies a `csrf-token` meta tag and guest session cookies. Send the
cookies and `X-CSRF-TOKEN` on public POST requests. With them, details returned
HTTP **200**. A nonexistent slug returned HTTP **404**,
`{success:false, errors:null, data:"not app "}`.
The MVP keeps guest cookies/token in memory only. No password or account is
required. A single CSRF refresh/retry on a rejected 419 is allowed; arbitrary
POST retries are not. Requests may trigger ordinary site analytics/counters.

### Response shapes used by the adapter

- Catalog: `id`, `name`, `slug`, `user_id`, `category_id`, `description`,
  `system`, `all_systems`, `ver`, `release`, `rpm32`, `rpm64`, `size`,
  `stars`, `download_count`, `latest_app`.
- Details: those fields plus `category`, `dev`, `screenshots`, `history`,
  `count`, `star`, `available_systems`. Rating/download field names differ.
  The live `category` value is an object `{id, label, ...}`, not a string;
  normalize its label and strip its remaining fields.
- Releases in `history`/`latest_app`: `id`, `system`, `ver`, `release`,
  `newcomment`, `created_at`, `rpm32`, `rpm64`, `sha256_32`, `sha256_64`.
- Dates are inconsistent: ISO timestamps and `DD-MM-YYYY`. Return bounded
  original strings instead of silently inventing timezone information.

Unknown response fields must be stripped. Public payloads contain a field
named `token`, contact email and unrelated service fields: **do not expose
them through MCP or log raw responses**. Runtime Zod validation detects
incompatible shapes. Strip HTML to bounded plain text; never execute it.
Return package/screenshot URLs only on the fixed Aurora Repos origin.
Never follow paginator URLs, arbitrary redirects, or URLs supplied by a model.

## MVP limits/policies

- Fixed origin `https://aurorarepos.ru`; no configurable arbitrary URL tool.
- Search: page >= 1, up to 20 items/page; category and author positive IDs.
- Slugs: lowercase ASCII letters/digits separated by hyphens, max 160 chars.
- Responses bounded to 2 MiB; text and array outputs additionally bounded.
- Timeout 15 seconds/request, max concurrency 2, requests spaced >= 250 ms.
- One retry for GET network failures, 429, 502, 503, 504; bounded backoff.
  Cancellation stops requests and waiting. No retry for 401/403/404.
- Errors returned as sanitized categories, not raw HTML/headers/stack traces.

## Deferred/unverified management API

Frontend-observed, **not called**: `POST /api/applogin`,
`POST /api/2fa/verify`, `GET /api/application`,
`POST /api/application/appname`, `POST /api/application` (multipart),
`GET /api/application/ver`. Earlier anonymous GET to `application/ver`
returned 401. Application data tokens are not assumed to be publisher
authentication tokens. Stable publisher API/permission from the operator is
still an open question; no contact has been made on the user's behalf.

## Fixtures and reproducibility

`tests/fixtures/` contains synthetic, anonymized representative JSON with the
observed field structure. It is not a dump of live cookies, tokens, contact
details, or user content. Tests may inject fake secret sentinels to verify
they never enter MCP outputs. Live checks are explicit/opt-in and read-only.

Sources: [website](https://aurorarepos.ru/),
[catalog](https://aurorarepos.ru/app), [API section](https://aurorarepos.ru/api),
[public frontend](https://aurorarepos.ru/js/app.js),
[details frontend](https://aurorarepos.ru/js/27.js).
