# aurorarepos-mcp

Unofficial local TypeScript MCP server for <https://aurorarepos.ru/>.
Stages 0–6 implementation covers: observed API contract, SDK v2 stdio scaffold,
anonymous read-only tools, secure out-of-band account login/session status
caller-owned developer app/release reads and local RPM release previews.
Stage 6 adds confirmed app-card creation/rename, new RPM releases, metadata edits
and website scheduling. Stage 7 adds release-candidate docs/changelog, archive
inspection and clean-install checks. Live multipart writes are not yet verified.
Server decides review/publication; no admin override, deletion, installation,
binary download or remote MCP transport.

## Tools

| Tool | Purpose | Main arguments |
| --- | --- | --- |
| `search_apps` | Search/filter/paginate public catalog | `query`, `aurora_version`, `category_id`, `author_id`, `sort`, `page`, `page_size` |
| `get_app` | Details, plain text, screenshots and RPM metadata | `slug`, `aurora_version` |
| `get_app_versions` | Public history/release notes and RPM metadata | `slug`, `aurora_version`, `page`, `page_size` |
| `list_categories` | Category IDs/names for search | `aurora_version` |
| `list_systems` | Available OS versions and website IDs | none |
| `list_author_apps` | Public apps by author, locally paginated | `author_id`, `page`, `page_size` |
| `auth_status` | Local account state; optionally verify against the site | `verify` (default false) |
| `list_my_apps` | Caller-owned developer catalog, latest release/status | `page`, `page_size` |
| `get_my_app` | Owned app details and latest release metadata | `app_id` |
| `list_my_app_versions` | Owned app releases, including non-public statuses | `app_id`, `page`, `page_size` |
| `get_my_app_version` | Selected owned release, shared description and screenshots | `app_id`, `version_id` |
| `prepare_release` | Local RPM metadata/checksum preview; no upload or approval | `rpm32_path`, `rpm64_path`, `aurora_versions`, `app_id`, `release_notes` |
| `create_app` | Create a name/card after exact user form confirmation; no release | `name` |
| `rename_my_app` | Rename an owned card after exact user form confirmation | `app_id`, `name` |
| `upload_release` | Upload a NEW owned release with preserved card fields | `app_id`, `rpm32_path`, `rpm64_path`, `aurora_versions`, `release_notes` |
| `update_my_app_version` | Update shared description/category and/or release notes | `app_id`, `version_id`, `description`, `category_id`, `release_notes` |
| `schedule_my_app_version` | Set/cancel website schedule, not forced publication | `app_id`, `version_id`, `is_delayed`, `publish_at` |

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

Public tools need no API key, password, cookies or environment variables. Use an
absolute `node` executable path as well if your host does not inherit PATH.
The CLI supports `--help` / `--version` on stderr; normal startup emits no
non-protocol stdout. This package remains private until release preparation.

## Account login (optional)

Run in your **own interactive terminal**, never send credentials to a model:

```sh
node dist/index.js auth login
node dist/index.js auth status
node dist/index.js auth status --verify
node dist/index.js auth logout
```

Email/password and any six-digit 2FA code are entered without echo. Login
refuses credential flags, environment variables and pipes. A protected read
checks authentication before saving. No password/2FA code is persisted. JSON
output and prompts go to stderr, not protocol stdout. Resending a code requires
explicitly typing `resend` at the 2FA prompt; no automated resend/relogin.

`auth_status` defaults to a local check: `stored` **does not prove** that the
session is valid. `verify=true` makes a protected read, distinguishing verified
authentication, 401 expiry and 403 access denial. Network/storage failures are
errors, not a claim that you are logged out. Public tools always use an isolated
anonymous cookie jar, including after login.

### Developer reads

After terminal login, call `list_my_apps`, then use its `id` as `app_id`.
Get `version_id` from `list_my_app_versions`; do not substitute the app ID.
All four tools verify the stored session's `dev` role and caller-scoped catalog
membership before private detail requests. Admin/unknown roles are refused:
there is no independently verified current-user-ID endpoint, and an admin-wide
catalog must not be interpreted as "my apps". No user/owner override is accepted.

Membership scans are limited to 500 apps/releases and the whole operation to
30 seconds. Large catalogs can return `LOOKUP_LIMIT`; they do not bypass ownership
checks. Each call reloads the encrypted session; reads do not rewrite its cookies.
Expired sessions require manual terminal login. `get_my_app_version` returns
`shared_app_description`, not a historical release-specific description snapshot.
Release status is `draft`, `pending_review`, `rejected`, `published` or `unknown`;
an app with no latest release has `no_release`. Beta/scheduling flags are separate.

### Cross-platform secure storage

`@napi-rs/keyring` stores a random encryption key in macOS Keychain, Windows
Credential Manager or Linux Secret Service. Cookies are stored in an authenticated
AES-256-GCM encrypted file, with a fresh nonce per save, outside the repository:

- macOS: `~/Library/Application Support/aurorarepos-mcp/auth/`
- Windows: `%LOCALAPPDATA%\\aurorarepos-mcp\\Data\\auth\\`
- Linux: `$XDG_DATA_HOME/aurorarepos-mcp/auth/`, default `~/.local/share/aurorarepos-mcp/auth/`

Linux requires an unlocked Secret Service provider (e.g. GNOME Keyring) and
its session D-Bus connection. SSH/headless/containers may not have one. We
explicitly disable automatic kernel-keyring fallback. A locked/unavailable
vault is an error; **there is no plaintext fallback** on any OS. OS vault access
may require user interaction. Account processes must share the same OS user,
vault and data directory. This is not protection against a compromised account
or malware that can access the unlocked vault.

Some stdio hosts sanitize environment variables. When no explicit D-Bus address
is provided, Linux discovers only an existing user-owned `bus` socket in a
private owned `XDG_RUNTIME_DIR` (or `/run/user/<uid>`); it does not start a bus
or override an explicit address. For custom setups, pass `DBUS_SESSION_BUS_ADDRESS`,
`XDG_RUNTIME_DIR` and any custom `XDG_DATA_HOME` from your login environment
through the host's stdio configuration. Do not pass passwords or all environment
variables indiscriminately. The default SDK-sanitized Linux stdio environment
has been live-tested with this discovery.

POSIX files/directories use 0600/0700; Windows uses the local user-data directory's
inherited ACL and encryption. Session data is bounded and validated, symlinks
are refused, writes atomically replace encrypted data, and a lock rejects
concurrent mutations. Do not delete `session.lock` without checking for a live
writer. A corrupted session is not silently overwritten.

Logout removes **only the local encrypted session and encryption key**. It
does not revoke cookies on Aurora Repos: use the website's logout separately.
Neither session data nor its key should be committed or sent to a model.

Opt-in native keyring test (temporary random test entry, deleted afterward):

```sh
pnpm smoke:keyring
```

The native test has been checked locally on Linux. macOS/Windows checks must
be run on those OSes; CI uses mocks and does not verify access to their vaults.
Account login and fresh-process CLI/MCP verification were also checked on Linux.
2FA/resend are covered by mocks, not yet checked against a live 2FA challenge.

## Local release preparation

`prepare_release` needs no login and makes no website request. Pass any absolute
path to a RPM accessible to the server's OS user; no directory configuration is
needed. Symlinks and hardlinks are accepted. On Windows use JSON-safe paths such
as `C:/projects/app/build/RPMS/app.rpm`. The old `AURORAREPOS_RPM_ROOTS` setting is
no longer used and can be removed. There is no disk search.

Example call with one or both architecture slots:

```json
{
  "name": "prepare_release",
  "arguments": {
    "rpm32_path": "/absolute/path/to/build/RPMS/app-1.2.3-1.armv7hl.rpm",
    "rpm64_path": "/absolute/path/to/build/RPMS/app-1.2.3-1.aarch64.rpm",
    "aurora_versions": [5],
    "app_id": 201,
    "release_notes": "Fix startup crash"
  }
}
```

At least one RPM is required. `rpm32` must contain `armv7hl`, `rpm64` must contain
`aarch64`; paired name/epoch/version/release must match. Only traditional binary
RPM v4-style packages are supported; source, x86, `noarch` and RPM v6 are refused.
Limits: 256 MiB/file, two files, bounded headers, 30-second operation deadline,
one local operation at a time. The resolved target must be a regular file;
changes detected during reading are refused so metadata/checksums stay consistent.

The preview contains basenames, allowlisted metadata, complete-file SHA-256,
plain release notes and explicit verification warnings. It is not persisted;
files are not changed, extracted, executed, signed, installed or uploaded.
`app_id` is optional and **not verified**; OS selections are declarations, not
proof of SDK compatibility. Signatures, embedded digests, payload contents and
dependencies are not verified. This is structural metadata preflight, not librpm
verification or upload approval. Release writes independently recheck files/target.

The local preflight is tested with synthetic packages, including real stdio calls.
Both user-built OpenTranslator 1.0.1-1 ARM release RPMs passed local preflight;
this does not verify signatures or SDK compatibility.
There is no directory sandbox: the tool can read RPMs anywhere the server's OS
user can access them, including paths reached through filesystem links.
See [release preparation security boundary](docs/release-preparation.md).

## Confirmed app-card writes

`create_app` creates an application name/card, **not a release or publication**.
`rename_my_app` renames an app ID from `list_my_apps`. These tools require terminal
login, verified `dev` role and a host supporting MCP form elicitation. Creating
an already-owned name is rejected. Names are bounded plain text, not HTML.

The host displays the exact action, app ID, previous/new name and contract warning
and asks the user to confirm (unchecked by default). Without accepted confirmation
no mutation is sent. There is no `confirm`/approval-token tool argument that the
model can supply. SDK v2 handles modern multi-round-trip and legacy shim flows.
The host is trusted to actually present the form to the user.

Confirmation expires after five minutes, is one-use and is bound to the arguments,
saved session and catalog/app state. Session switches/logout, changed state and
forged/replayed requests fail before POST. CSRF is bootstrapped in the authenticated
jar and the role checked again. Mutation redirects are rejected and mutations
are never automatically retried, including 419 failures.

Empty hashed attempt markers live in the session data directory's `write-attempts/`
subdirectory (outside Git), with OS-user permissions; maximum 4096 markers. They
block concurrent and restarted attempts. Markers have no credentials, names,
contacts, RPM paths or upstream payloads. They are retained after success or failure,
including uncertain failures, and are not automatically cleared on local logout.
There is no journal reset/recovery command yet; do not automatically delete markers
to bypass a failed write. Inspect the website/read tools first and request manual
recovery if necessary.

`WRITE_OUTCOME_UNKNOWN` means the server may have changed the site but could not
verify the result; it does **not** mean nothing happened. `WRITE_ALREADY_ATTEMPTED`
also requires inspection, not an automatic retry. Success is reconciled by owned
catalog/details and returns `publication_requested=false`, not a claim that an
existing app is unpublished. Write-response messages and refreshed cookies are
not forwarded or persisted.

Both tools are tested against synthetic HTTP, including accepted/declined forms
over legacy/automatic protocol connections. **No live create/rename was performed.**
Frontend contract observations are not full live backend verification.
Image/contact/beta/tester mutations, token generation and deletion remain
unsupported; release operations are documented below.
See [observed write contract and gaps](docs/write-contract.md).

## Confirmed release writes

`upload_release` creates a NEW release of an existing configured app, not RPM
replacement on an old release. Pass paths/OS/notes as in `prepare_release` and
a mandatory owned `app_id`. It checks ARM slots/pair metadata, existing package
name/version/OS and the site's 100,000,000-byte file limit. Exact user form
confirmation includes basenames, SHA-256, version, OS and notes. Files, state
and session are rechecked after approval; immutable checked bytes are sent once.
Read-back verifies a unique release, server SHA-256, notes and shared fields.

```json
{"name":"upload_release","arguments":{"app_id":201,"rpm32_path":"/absolute/app-1.2.3-1.armv7hl.rpm","rpm64_path":"/absolute/app-1.2.3-1.aarch64.rpm","aurora_versions":[5],"release_notes":"Fix startup"}}
{"name":"update_my_app_version","arguments":{"app_id":201,"version_id":301,"release_notes":"Corrected notes"}}
{"name":"schedule_my_app_version","arguments":{"app_id":201,"version_id":301,"is_delayed":true,"publish_at":"2026-12-01T15:30"}}
{"name":"schedule_my_app_version","arguments":{"app_id":201,"version_id":301,"is_delayed":false}}
```

Metadata edits accept plain-text `description`/`release_notes` and `category_id`.
Description/category affect the SHARED app across releases. Unspecified fields,
contacts, owner, icon, screenshots, beta, schedule and RPM references/digests are
retained and checked. Missing editor fields fail closed. Empty new cards must
first be configured with description/category/icon/screenshots on the website;
these tools do not upload image assets or mutate contacts/beta/testers.

Scheduling accepts website wall-clock `YYYY-MM-DDTHH:mm`, NOT inferred UTC/local
conversion; `publish_at` is required iff delayed is enabled. Stored flags/date
are verified, but timezone/execution remain unverified. There is no observed
separate developer-side publish/review endpoint or admin override. The output's
`publication_state` is read-back state: `pending_review` is NOT published.

Release writes share the one-use five-minute approval and durable journal of
name writes, a 120-second operation deadline, no automatic retry/relogin and no
redirect forwarding. On uncertain outcome inspect release reads/the website;
do not delete attempt markers or blindly resend. No live multipart write or
scheduled execution has yet been performed.

## Release candidate checks

```sh
pnpm check
pnpm smoke:package
# Optional once production dependencies are cached:
pnpm smoke:package --offline
```

The archive smoke inspects allowlisted files, installs the actual local archive
in a fresh temporary consumer with lifecycle scripts disabled, checks CLI stdout,
both MCP negotiation modes, 17 tools and local synthetic RPM preflight. It may
fetch registry dependencies, but never contacts Aurora Repos or accesses account
state/the vault. Temporary projects are removed afterward. CI includes this test;
hosted runs and native macOS/Windows vault checks remain unrun here.
See [release checklist](docs/release-checklist.md) and [changelog](CHANGELOG.md).
The npm package remains private; application publishing does not imply Git push
or external npm/Registry publication.

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
does not access Aurora Repos or an OS vault. CI is configured for Node 22/24
on Linux/macOS/Windows; hosted CI has not been dispatched in this task.

Explicit live smoke test, **accesses the website** using public read requests:

```sh
pnpm smoke:live
```

It checks all six tools, validates outputs and prints counts, not raw data.

Explicit authenticated live stdio smoke test (requires a saved developer session
with at least one app and release):

```sh
pnpm smoke:developer
```

It checks all four developer tools and prints only counts/selected status. The
four reads have been checked on Linux with a published release; other statuses
and older-release selection are covered by synthetic fixtures, not live accounts.

## Safety/limits

- Fixed `https://aurorarepos.ru` origin and explicitly allowlisted endpoints.
  Public redirects are rejected; account POST redirects are never followed or
  forwarded. Login 302/303 responses are only candidates: Location is ignored
  entirely and a fixed HTTPS protected GET must verify the session before saving.
  Other redirect statuses are rejected. No arbitrary URL fetching/paginator following.
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
- Developer endpoints use authenticated GET only, with a separate shared HTTP
  gate from anonymous tools. Private payloads are not saved; owner/contact/token
  fields are checked internally where needed but never returned.
- Local release preparation has an independent one-operation gate and accepts
  arbitrary absolute RPM paths; it never accesses the account or HTTP. Its checks
  do not establish trusted signatures, installability or user approval.
- App-card writes have a separate serialized gate, bounded one-use confirmations,
  a durable attempt journal, exact-user form approval and read-back reconciliation.
  There are no mutation retries or automatic journal resets.

## Layout

```text
src/index.ts           stdio lifecycle
src/server.ts          MCP factory
src/tools/             registration and safe result formatting
src/auth/              interactive CLI, account client, encrypted session/vault
src/developer/         caller-owned reads, runtime schemas and normalization
src/release/           local RPM reads, bounded preflight and preview
src/writes/            confirmed app-card writes and durable attempt markers
src/aurora/client.ts   fixed endpoints, guest cookies/CSRF, bounded HTTP
src/aurora/gate.ts     rate/concurrency/cancellation
src/aurora/service.ts  API parsing and public operations
src/aurora/schemas.ts  runtime input/upstream/output schemas
src/aurora/normalize.ts allowlisted fields, HTML and URL normalization
tests/                 synthetic fixtures and HTTP/service/protocol tests
scripts/live-smoke.ts  opt-in public live check
scripts/keyring-smoke.ts opt-in native vault check
scripts/developer-smoke.ts opt-in authenticated stdio read check
```

See [observed API contract](docs/api-contract.md) and
[authentication contract](docs/auth-contract.md) and
[developer read contract](docs/developer-contract.md), plus
[implementation milestones](docs/implementation-plan.md).
The website's internal API may change. This project is unofficial.
