# Local release preparation (stage 5)

`prepare_release` produces an in-memory, reviewable preview only. No account
access, HTTP, upload, signing, installation, extraction, subprocesses or file
writes. No approval token or durable upload capability is produced. Stage 6
must independently revalidate ownership, file bytes and explicit approval.

## Inputs and operator policy

The operator sets `AURORAREPOS_RPM_ROOTS` to a JSON array of up to eight absolute
dedicated build directories in the server's environment. Empty/missing policy
disables preparation. Invalid policies fail the tool without breaking public
reads. Volume roots, the user's home itself, UNC/device paths are refused.
Never accept roots, arbitrary URLs or an owner override as tool arguments.

Inputs: `rpm32_path` and/or `rpm64_path` (absolute local paths), explicitly
selected `aurora_versions` (4 and/or 5), optional target `app_id`, and bounded
plain-text `release_notes`. Target/OS selections are **user declarations**, not
proof of ownership or compatibility. The app ID is not queried or trusted.

Files must be regular, single-link `.rpm` files contained within an explicitly
allowed canonical root. Refuse symlinks below that root, traversal components,
Windows alternate streams, non-local path syntax and sibling-prefix escapes.
Open read-only, use no-follow where available, compare file identity/size/times
before and after reading and revalidate path/root identity. Do not search disk.
Output only bounded basenames/allowlisted package fields, never full paths,
payload, scriptlets, packager/contact values or unknown header tags.

These checks reduce accidental/path-based exposure, but portable Node APIs do
not give a race-free open-beneath sandbox against hostile concurrent directory
replacement on every OS. Use dedicated, trusted build directories owned by
the operator; hostile local users/malware require an OS sandbox. Configured
network-mounted directories are the operator's responsibility.

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

Implemented and checked locally on Linux: synthetic parser/policy/checksum/
mutation/cancellation tests, schema-valid MCP calls and real stdio subprocesses
with legacy and automatic negotiation. Full local suite: 243 passing tests.
Native macOS/Windows execution and an SDK-built RPM preflight remain unverified;
CI is configured for those OSes but has not been dispatched externally here.
