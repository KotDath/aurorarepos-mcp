# Changelog

## 1.0.1

- Optional stdio launch flag `--yolo`: all five write tools execute without MCP
  form confirmation, including from clients without elicitation support.
- Default startup retains exact-user confirmations. Authentication, ownership,
  RPM/state/session checks, duplicate-attempt journal and read-back are unchanged.
- Mode-aware server instructions/tool descriptions and Russian YOLO setup docs.

## 1.0.0

- Russian README with installation, account login, usage examples and setup
  guides for OpenCode, Claude Code, Codex, Oh My Pi and ZCode.

- TypeScript SDK v2 stdio server with six anonymous catalog tools and strict
  schemas/structured results; guest/account cookie isolation and bounded reads.
- Out-of-band terminal login/2FA, encrypted session files and native OS vault key.
- Four caller-owned developer read tools with verified dev scope and membership.
- Absolute-path ARM RPM preflight with matching pair metadata/full-file SHA-256;
  no signature, payload or SDK compatibility verification.
- Exact-user-confirmed app-card creation and rename.
- Exact-user-confirmed new-release uploads, shared description/category/notes
  updates and website scheduling with preserved contacts/media/RPM references.
- Immutable upload bytes, website file limits, state/session rechecks, durable
  duplicate-attempt markers and read-back checks; no automatic mutation retries.
- Clean-install archive smoke on both MCP protocol eras; CI matrix for
  Linux/macOS/Windows, Node 22/24. Native vault checks performed on Linux only.

Live new-release multipart upload/publication was verified on the explicitly
confirmed OpenTranslator 1.0.1 target: both hashes/shared metadata match and the
release is visible anonymously. Metadata/schedule edits, server timezone and
delayed execution remain unverified live. Server decides publication/
moderation status; no separate developer publication endpoint or admin override
is exposed. First releases on empty cards requiring icon/screenshots must be
configured via the website. Contact, beta/tester and image-asset mutations are
outside the current tools. Remote HTTP transport remains optional/deferred.
