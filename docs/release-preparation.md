# Local release preparation (stage 5)

`prepare_release` produces an in-memory, reviewable preview only. No account
access, HTTP, upload, signing, installation, extraction, subprocesses or file
writes. No approval token or durable upload capability is produced. Stage 6
must independently revalidate ownership, file bytes and explicit approval.

## Inputs and filesystem access

At the user's explicit request, preparation accepts any absolute RPM path
accessible to the server's OS user. No directory allowlist or opt-in environment
setting. `AURORAREPOS_RPM_ROOTS` is obsolete and ignored. This is not a directory
sandbox. Paths are OS filesystem paths, not arbitrary HTTP URLs; no owner
override is accepted as a tool argument.

Inputs: `rpm32_path` and/or `rpm64_path` (absolute local paths), explicitly
selected `aurora_versions` (4 and/or 5), optional target `app_id`, and bounded
plain-text `release_notes`. Target/OS selections are **user declarations**, not
proof of ownership or compatibility. The app ID is not queried or trusted.

Files must resolve to regular `.rpm` files. Symlinks, directory links, hardlinks
and absolute paths containing normalization components are accepted. Resolve
the path and open read-only; compare file identity/size/times before and after
reading and check that the path still resolves to the same target. These are
checksum/metadata consistency checks, not directory authorization. Do not search disk.
Output only bounded basenames/allowlisted package fields, never full paths,
payload, scriptlets, packager/contact values or unknown header tags.

Access is determined by OS permissions, including for mounted/network filesystem
paths. Portable Node APIs do not provide a race-free sandbox against hostile
concurrent file/directory replacement; no such isolation is claimed.

## Bounded structural preflight

Read the traditional RPM lead, signature header, alignment padding and main
header; validate bounds/types/duplicate tags and immutable-region trailers.
Extract name/version/release/epoch/OS/architecture and payload format/compressor.
Only binary RPM v4-style packages with `armv7hl` in the 32-bit slot and `aarch64`
in the 64-bit slot are accepted. Source, x86, `noarch`, RPM v6 and unknown formats
are explicitly unsupported, not guessed. Paired packages must have identical
name, epoch, version and release. A declared cpio payload must be non-empty.

At most two files, 256 MiB each; headers at most 8 MiB each and 4096 entries,
bounded aggregate string scanning. SHA-256 is computed over the complete file
using bounded chunks. Shared local gate: one operation at a time, bounded queue,
30-second whole-operation deadline and cancellation. No full-file buffering.

This is a **structural metadata preflight**, not librpm verification. No trusted
signature verification, embedded-digest verification, cpio decompression,
dependency/installability check, malware check or SDK/OS compatibility proof.
These omissions are explicit warnings in every successful preview. A checksum
identifies the bytes read; it does not approve them or bind future uploads.

Sources consulted on 2026-09-16:

- [RPM v4 package format](https://rpm.org/docs/6.0.x/manual/format_v4.html)
- [RPM header format](https://rpm.org/docs/6.0.x/manual/format_header.html)
- [RPM lead format](https://rpm-software-management.github.io/rpm/manual/format_lead.html)
- [RPM tags](https://rpm.org/docs/6.0.x/manual/tags.html)
- [Aurora SDK targets](https://developer.auroraos.ru/doc/sdk/app_development/work/launch)

RPM's documentation recommends librpm for full verification; the portable parser
here intentionally does not claim that scope. Test data must remain synthetic;
no search for or reading of the user's existing packages is implied.

Implemented and checked locally on Linux: synthetic parser/path/checksum/
mutation/cancellation tests, schema-valid MCP calls and real stdio subprocesses
with legacy and automatic negotiation, without directory configuration.
Native macOS/Windows execution and an SDK-built RPM preflight remain unverified;
CI is configured for those OSes but has not been dispatched externally here.
