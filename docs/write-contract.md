# Developer writes — observed contract and stage 6 boundary

Public frontend inspected on 2026-09-16 with anonymous GET only. No mutation
request, live account payload, RPM upload or publication was made during discovery.

| Action | Observed request | Evidence / gap |
| --- | --- | --- |
| Create/rename app card | `POST /api/application/appname`, JSON form `id,name` | list frontend: empty id for create, app id for rename; reloads catalog on success |
| Add release to an app | `POST /api/application`, multipart | source metadata from `GET /api/application/name/{app_id}`; uses `app_id`, `file_rpm`, `file_rpm64`, name/description/category/version/system/release, retained icon/screenshots and shared contact/owner/flag fields |
| Edit release | same multipart endpoint with `id` = release id | editor sends complete shared app fields, retained screenshots and scheduling, without RPM replacement |
| Schedule | `is_delayed` and `publish_at` in editor multipart | datetime-local string; server timezone, status transitions and actual scheduling behaviour not verified |
| Review/publication | not identified in developer frontend | do not invent a status-changing endpoint based on numeric status codes |

Frontend upload controls cap individual RPMs at 100,000,000 bytes. Aurora 4
(`system=2`) hides the 64-bit slot; systems 1/3 need separately checked semantics.
Adding a release requires an icon in the editor. Creating a card is not creating
a release or publishing it. A multipart metadata edit is not an isolated patch:
omitting/reconstructing fields may unintentionally erase contact/screenshot data.

## Implemented operations

Create/rename cards plus `upload_release`, `update_my_app_version` and
`schedule_my_app_version` are implemented and synthetic-tested. The latter
operations follow both source forms in bundle 439, without evaluating site code.
Upload creates a NEW release of an existing fully configured app. Metadata edits
preserve RPMs; scheduling sets editor flags, not status. There is no observed
developer-side separate review/publication request: the server decides status.
Admin publication override is intentionally absent.

Required preservation fields must be present and valid in the editor response:
name, description, category, system, site/donate/email, owner, icon, screenshots,
validator/unofficial flags and schedule. Missing/unknown fields fail closed.
Existing asset references must be same-origin `/image/` URLs without query/hash;
no asset is downloaded or transformed. Fresh empty cards requiring initial
icon/screenshots/contact setup must be configured using the website first;
uploading/changing image assets and contact/beta management are not exposed.

Uploads cap each file at 100,000,000 bytes (the website limit), use existing ARM
preflight, reject mismatched pairs, Aurora-4-only 64-bit uploads, conflicting
version/release/system and mismatched existing RPM package names. Both-OS system
3 may include 64-bit, as allowed by the observed frontend. Approval includes
exact basenames/checksums/version/OS/notes. At commit, immutable captured bytes
are hashed from the same checked file handle and compared with the preview;
FormData receives only those bytes. Node sets the multipart boundary. No retry
or redirect is allowed, including CSRF errors. Dispatch has a 120-second deadline.

Read-back verifies a unique new release, server SHA-256 for each uploaded slot,
notes and unchanged shared/contact/media fields. Metadata/schedule edits verify
the selected owned release and retain package references/digests/version/system.
Any uncertain dispatch/reconciliation is `WRITE_OUTCOME_UNKNOWN`. Upload attempt
markers are owner/app/OS/content-bound and survive relogin and filename changes.
They are not approval tokens and must not be silently removed.

Scheduling accepts/cancels `YYYY-MM-DDTHH:mm` website wall-clock values, checks
calendar validity and does not guess the server timezone. Read-back verifies the
stored flags/time, NOT execution of delayed publication. Outputs always expose
`scheduling_timezone_verified=false` and observed publication state.

Confirmation comes from MCP form elicitation, not a model-supplied `confirm=true`.
SDK v2 `inputRequired` supports modern multi-round-trip and legacy shim flows.
A random opaque, process-local ticket is bound to normalized arguments, current
saved-session fingerprint and pre-write catalog/app snapshot; expires after five
minutes, one use, bounded pending capacity. Never put credentials or raw private
fields in request state or approval text. Reject forged/modified/replayed state,
decline/cancel, session switches and stale snapshots before POST. A host without
elicitation cannot write. The host is trusted to present the form to the user.

Immediately before a write, recheck role `dev`, ownership where applicable and
approved state. Use authenticated CSRF with a fixed endpoint, reject redirects,
never auto-relogin or retry a mutation (including 419). Persist a bounded
attempt marker before dispatch to block duplicate concurrent/restarted attempts.
Ambiguous dispatch/response/reconciliation errors are `WRITE_OUTCOME_UNKNOWN`,
not "nothing changed"; ask for manual read-only inspection, never resend.

Read back the caller-scoped catalog/details to reconcile the exact changed name.
Do not forward upstream messages, raw bodies, tokens or contacts. No account
cookies are persisted from writes, avoiding concurrent stale-session overwrite.

Attempt markers are empty `<sha256>.attempt` files under the local encrypted
session directory's `write-attempts/` subdirectory. Claims use exclusive creation,
user-owned private directory and 0600 files; cap 4096. Keep all attempted intents,
including ambiguous outcomes, across processes/restarts/logout. No reset/recovery
command is implemented; do not silently clear markers. Read-only inspection and
manual recovery are required rather than reissuing an uncertain mutation.

Checked locally on Linux: 317 tests, including multipart payload/checksums,
metadata/media preservation, escaped text, schedule validity, changed RPM/state,
duplicate version/name/durable attempts, role checks, both-era form confirmation,
and name JSON/CSRF headers, single
dispatch, scope/ownership, stale/changed session, one-use/replayed/expired tickets,
durable/concurrent duplicate claims, 419/redirect/network/invalid/read-back outcomes,
and accepted/declined/unsupported host elicitation on legacy/automatic protocol
connections. One user-confirmed new-release upload was live-verified as published
for OpenTranslator 1.0.1, including both hashes/shared field preservation and an
anonymous public read. Create/rename and metadata/schedule edits remain synthetic
only; delayed execution/timezone are unverified. See [live result](live-release-check.md). Native
macOS/Windows/host UI verification remains outstanding.

Sources: [app list](https://aurorarepos.ru/js/348.js),
[release editor](https://aurorarepos.ru/js/439.js),
[release list](https://aurorarepos.ru/js/594.js).
