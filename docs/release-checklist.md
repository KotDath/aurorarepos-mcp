# Local release candidate checklist

Completed on Linux:

- Lint, strict production/test/script typecheck, build and 317 synthetic tests.
- Real stdio handshake/preflight and user confirmation across both protocol eras.
- Runtime archive allowlist: dist JavaScript/declarations, manifest, README,
  LICENSE and CHANGELOG only; no tests, sources, credentials, sessions or RPMs.
- Actual archive installed in a fresh temporary consumer with lifecycle scripts
  disabled; CLI stdout, 17 tools and local RPM preflight checked in both modes.
- Archive has 78 allowlisted files; regular and cached/offline installation pass.
- Production npm audit reports zero vulnerabilities at the time of checking.
- CI includes checks/package smoke for Linux/macOS/Windows with Node 22/24.
- Native Linux vault smoke and fresh-process account checks from earlier stages.
- Both user-built OpenTranslator 1.0.1-1 ARM RPMs pass structural preflight.
- Manifest stays private; no external npm/Git/GitHub/Registry publication.

Live validation gate (not yet completed):

1. User runs `node dist/index.js auth login` in their own interactive terminal;
   no credential flags/chat secrets, manual 2FA when required.
2. Verify session/dev role, locate owned OpenTranslator card and selected prior
   release. Inspect full editor preservation fields without logging contacts.
3. Show exact target/version/OS/packages/checksums/notes in a user confirmation
   form; refuse missing/changed fields/state/files and duplicate release.
4. Send one multipart request, without auto retry. Reconcile unique release,
   server checksums, notes and retained shared metadata/contact/media.
5. Inspect observed status. Pending review is not publication. If the site
   requires a developer action not present in the observed contract, inspect it
   first; never invent a status endpoint or use admin capabilities.
6. Confirm public 1.0.1 appears only when the server reports/presents publication.
   Do not silently poll indefinitely or resend an uncertain upload.

Pending independent checks: native macOS/Windows vault integration, hosted CI,
live scheduling timezone/execution and optional 2FA/resend challenge. Asset,
contact/beta/tester mutations and initializing empty cards remain outside current
tools. No remote HTTP MCP transport is required for this local release candidate.
