# Developer writes — observed contract and stage 6 boundary

Public frontend inspected on 2026-09-16 with anonymous GET only. No mutation
request, live account payload, RPM upload or publication was made during discovery.

| Action | Observed request | Evidence / gap |
| --- | --- | --- |
| Create/rename app card | `POST /api/application/appname`, JSON form `id,name` | list frontend: empty id for create, app id for rename; reloads catalog on success |
| Add release to an app | `POST /api/application`, multipart | editor uses `app_id`, `file_rpm`, `file_rpm64`, name/description/category/version/system/release, icon/screenshots and shared contact/owner/flag fields |
| Edit release | same multipart endpoint with `id` = release id | editor sends complete shared app fields, retained screenshots and scheduling, without RPM replacement |
| Schedule | `is_delayed` and `publish_at` in editor multipart | datetime-local string; server timezone, status transitions and actual scheduling behaviour not verified |
| Review/publication | not identified in developer frontend | do not invent a status-changing endpoint based on numeric status codes |

Frontend upload controls cap individual RPMs at 100,000,000 bytes. Aurora 4
(`system=2`) hides the 64-bit slot; systems 1/3 need separately checked semantics.
Adding a release requires an icon in the editor. Creating a card is not creating
a release or publishing it. A multipart metadata edit is not an isolated patch:
omitting/reconstructing fields may unintentionally erase contact/screenshot data.

## First implementation slice

Create/rename card is implemented and synthetic-tested first. Multipart uploads, metadata editing,
scheduling and publication remain deferred until their complete contract and
preservation semantics are established. Do not label this slice all of stage 6.

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

Checked locally on Linux: 276 tests, including name JSON/CSRF headers, single
dispatch, scope/ownership, stale/changed session, one-use/replayed/expired tickets,
durable/concurrent duplicate claims, 419/redirect/network/invalid/read-back outcomes,
and accepted/declined/unsupported host elicitation on legacy/automatic protocol
connections. No live create/rename/upload/publication test was run. Native
macOS/Windows/host UI verification remains outstanding.

Sources: [app list](https://aurorarepos.ru/js/348.js),
[release editor](https://aurorarepos.ru/js/439.js),
[release list](https://aurorarepos.ru/js/594.js).
