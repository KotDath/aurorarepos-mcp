# Implementation milestones

1. **Stage 0 — observed API contract:** endpoint/status/system mapping,
   sanitized representative fixtures, explicit gaps. No writes to the site.
2. **Stage 1 — scaffold:** TypeScript ESM, Node 22+, pnpm lockfile, SDK v2,
   stdio, lint/typecheck/test/build, CI and protocol smoke test.
3. **Stage 2 — anonymous read-only MVP:** separate HTTP/service/tools layers;
   `search_apps`, `get_app`, `get_app_versions`, `list_categories`,
   `list_systems`, `list_author_apps`; input/output schemas, bounded output,
   guest CSRF, cancellation, safe retry, mocked integration and opt-in live
   checks. Inspect `tools/list` and real tool calls over stdio.
4. **Stage 3 — account authentication:** out-of-band terminal login/2FA,
   protected session store outside Git, auth status/logout. No secrets as
   tool arguments or returned content.
5. **Stage 4 — developer read operations:** own apps, versions, statuses;
   `list_my_apps`, `get_my_app`, `list_my_app_versions`, `get_my_app_version`;
   verified `dev` role, bounded caller-catalog membership checks and session
   expiry handling. No admin-wide fallback or site writes.
6. **Stage 5 — prepare release without uploading:** RPM/file validation,
   `prepare_release`, any absolute RPM path accessible to the server OS user,
   resolved-file identity checks, bounded RPM structure/architecture/pair preflight,
   full-file SHA-256 and an in-memory reviewable preview. Not signature or SDK
   compatibility verification; no account access, approval capability or upload.
7. **Stage 6 — confirmed writes:** create/upload/update/schedule, verified
   server contract, user approval enforced, duplicate-upload protection.
   No automatic upload retry after ambiguous failures.
8. **Stage 7 — release hardening:** clean-install test, docs, package review,
   changelog, releases. Publishing npm/GitHub/Registry is a separate action.
9. **Stage 8 — optional remote transport:** Streamable HTTP, separate MCP
   auth and Aurora auth, per-user isolation, Origin checks, compatibility.

Stages 0–5 are now implemented. Local checks include lint, typecheck, build,
HTTP/service/protocol tests, real subprocess handshakes, Inspector CLI and
an explicit anonymous live smoke check. Stage 3 additionally checks encrypted
storage with a native Linux vault smoke test, account login and fresh-process
CLI/MCP session verification. 2FA is mock-tested only. CI is configured for
Linux/macOS/Windows and Node 22/24; native macOS/Windows vault integration has
not been run here, and hosted CI has not been dispatched externally. Stage 4
adds synthetic ownership/status/limit/cancellation tests, all four protocol
calls and an opt-in live authenticated stdio smoke check with a published
release. Draft/review/rejection and old-release selection are fixture-tested
only. Stage 5 adds synthetic RPM parser/path/checksum/mutation/cancellation
tests and real stdio preflight calls with legacy/automatic negotiation. Both
user-built OpenTranslator 1.0.1 ARM RPMs passed preflight. Allowlisting was removed at the
user's request; links and arbitrary absolute RPM paths work without configuration.
Stage 6 implementation now includes create/rename cards, confirmed NEW release
uploads, shared description/category and release-note edits, and website
scheduling. Five-minute one-use confirmations bind arguments/session/state/files;
durable owner/content-bound attempt markers and read-back checks prevent blind
retry. Multipart follows both observed frontend forms; edits retain RPMs and
all unchanged editor fields/media/contacts. Server decides publication status;
no separate developer publication endpoint or admin override is exposed.
Fresh empty cards requiring initial image/contact setup use the website first.
Live multipart/preservation/status verification and actual delayed execution
remain pending an explicit account/target test. Timezone is not guessed.
The full local suite has 317 passing tests. Stage 7 implementation adds changelog,
release checklist, archive allowlist review and real clean installation of the
local archive with both negotiation modes and 17 tools; CI includes this smoke.
The file-symlink test is skipped on Windows, where junctions
are tested instead.

Each completed stage gets a local commit after appropriate checks. No push
or external publishing is implied. Stages 6–7 implementation and Linux local
checks are ready; live release-write validation, hosted CI and native macOS/
Windows vault checks are still pending. Do not claim end-to-end publication or
scheduled execution before observing it. Stage 5 preview is not upload approval.
External npm/GitHub/Registry publishing and optional stage 8 remain deferred.

SDK 2.0.0 is published as `@modelcontextprotocol/server`, Node >=20.
Use Node >=22 here. The 2026-07-28 HTTP spec removes protocol-level sessions
and GET streams; don't copy legacy examples without compatibility checks.
Tools carry strict schemas and structured results. Annotations are hints,
not authorization. stdout is reserved for MCP; diagnostics go to stderr.

References:

- [SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Security](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- [Inspector](https://github.com/modelcontextprotocol/inspector)
