# Developer read API (stage 4)

Verified with an existing encrypted developer session on 2026-09-16.
Discovery used GET only. Live data, credentials, cookies and contact/token
fields were not saved. Fixtures are synthetic. No other author's private app
was queried, and no upload/publication/profile mutation was made.
All four operations passed live adapter and fresh-process MCP stdio checks
with one owned app and one published release. The six anonymous tools also
have a separate live regression check; neither check prints private payloads.

| Read | Fixed endpoint | Observed response |
| --- | --- | --- |
| Role | `GET /api/getrole` | plain/JSON role identifier; `dev` for the checked session |
| Developer app list | `GET /api/application?page=P&pagination=N` | `{success:true,data:{current_page,per_page,last_page,total,data:[app]},message}` |
| App details | `GET /api/application/{appId}` | raw app object, including `user_id` and `latest_app` |
| App releases | `GET /api/application/ver?page=P&pagination=N&id=appId` | same nested paginator wrapper, release records with `application_id` |
| Release edit/read details | `GET /api/application/appitem/{releaseId}` | **app** object: root `id` is appId, not releaseId; selected `ver/release/system/newcomment`, screenshots and `latest_app` |

The role and `X-Requested-With` header follow the public frontend. Read endpoints
are not assumed to need CSRF: verified authenticated GET requests worked.
Request URLs and query parameters are constructed internally; never follow
paginator URLs or accept arbitrary URLs, user IDs, role overrides or tokens.

## Ownership/permissions

The non-admin developer list is the source of caller-owned app membership.
Require a verified `dev` role before querying it. **Admin and unknown roles are
not supported in stage 4:** an admin-wide list must not become "my apps". The
site exposes no independently verified current-user-ID endpoint for this use;
blank `GET /api/userprofile?id=` returned an empty body and is not used.

Before a detail read, find appId in the caller-scoped catalog, then validate
that every catalog page has the same positive `user_id`. Check detail root
`id/user_id` against that membership. Before reading releaseId, find it in
that app's release list; validate all `application_id` values and any nested
`application.id/user_id`. A caller-supplied ID alone never authorizes a read.
Wrong IDs fail before the detail endpoint is queried.

Membership scans are bounded to 25 pages of 20 items (500 apps/releases).
If membership cannot be established within that bound, return an explicit
lookup-limit error instead of fetching unverified private data. No positive
membership is cached across tool calls/login/logout. Each call reloads the
encrypted session; no automatic relogin or privilege fallback.

`appitem` may contain an overall `latest_app`, especially for older releases.
Do not assume that it is the selected release. Status/notes/hashes/packages
come from the matched release-list record. Validate the edit payload's root
app/owner and selected `ver/release/system`; label description as shared app
description, not a historically versioned snapshot. Old-release payloads have
not been separately live-verified; fail closed on an inconsistent selection.

## Fields/status semantics

Apps: allowlist id/name/slug/category/description, OS IDs, latest release,
created/updated dates, `is_beta`, `is_delayed`, `publish_at`, `validator/notoff`.
Do not expose email, account/app tokens, contact/donation URLs, tester lists,
user/profile records, arbitrary links or unknown fields.

Releases: id/application_id/system/ver/release/status/newcomment, dates,
RPM paths and SHA-256. Frontend `js/594.js` maps codes:
`0` draft, `1` pending_review, `2` rejected, `3` published. Preserve unknown
codes as `unknown`; an app without a latest release is `no_release`, not an
invented draft. Scheduling/beta flags are separate from release status.
Only a published release was live-checked; draft/review/rejection use fixtures.

RPM metadata may use `/rpm/` rather than public `/download/`. Return only
same-origin HTTPS URLs under those prefixes, removing query/hash/credentials;
never download/execute files. Screenshots use `/image/`. All site text remains
untrusted and is converted to bounded plain text. Dates remain bounded original
strings, without invented timezone interpretations.

## Operational limits

Strict inputs: positive safe IDs, page 1–10000, 1–20 items/page. Validate nested
paginator page/size/count metadata. Shared authenticated HTTP gate: concurrency
2, 250 ms spacing, bounded queue; existing 15-second request/2 MiB limits.
Additionally bound a whole developer tool operation to 30 seconds. Propagate
cancellation. 401 asks for manual login; 403 is denial, not necessarily expiry.
Never log raw responses/headers or persist private app payloads. Stage 4 reads
do not update the stored session, avoiding stale concurrent session overwrites.

Sources: [developer list frontend](https://aurorarepos.ru/js/348.js),
[release/status frontend](https://aurorarepos.ru/js/594.js),
[release details frontend](https://aurorarepos.ru/js/439.js).
