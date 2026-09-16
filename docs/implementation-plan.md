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
   role checks and session expiry handling.
6. **Stage 5 — prepare release without uploading:** RPM/file validation,
   allowed directories/realpath, hashes and reviewable preview.
7. **Stage 6 — confirmed writes:** create/upload/update/schedule, verified
   server contract, user approval enforced, duplicate-upload protection.
   No automatic upload retry after ambiguous failures.
8. **Stage 7 — release hardening:** clean-install test, docs, package review,
   changelog, releases. Publishing npm/GitHub/Registry is a separate action.
9. **Stage 8 — optional remote transport:** Streamable HTTP, separate MCP
   auth and Aurora auth, per-user isolation, Origin checks, compatibility.

Each completed stage gets a local commit after appropriate checks. No push
or external publishing is implied. Stages 0–2 are the current scope.

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
