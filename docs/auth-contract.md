# Account authentication (stage 3)

Observed anonymously on 2026-09-16 in the site's public login frontend:

- `POST /api/applogin`: JSON `{email, password, code: null}`, guest cookies
  and `X-CSRF-TOKEN`. A response containing `2fa_required: true` carries
  `method` and a temporary `token`; otherwise the frontend reloads.
- `POST /api/2fa/verify`: JSON `{code, token}`. The frontend requires a
  six-character code. The temporary token is not a publisher API token.
- `POST /api/2fa/resend`: JSON `{token}`; never automatically called.
- `GET /api/getrole`: used by the developer frontend, which compares the
  returned JSON string with `admin`. Anonymous GET returned 401. Use this
  small, read-only protected endpoint to verify a session; never treat a
  successful login HTTP status alone as proof of authentication.

Successful account login and 2FA are not yet live-verified. Do not print
raw responses, cookies, passwords, temporary tokens, email addresses or
request bodies. Tests use synthetic values, never live account credentials.
No upload, publication, profile mutation, 2FA configuration or password change
is part of stage 3. No server logout endpoint has been verified: CLI logout
removes the local session/key only, and must say so explicitly.

## Local design

- Interactive `auth login` is terminal-only. No credential flags, environment
  variables, piped credentials, MCP input arguments or browser-cookie imports.
- Password/code are hidden; neither is persisted. Login POST is not retried
  after ambiguous errors. One retry after a rejected 419 refreshes CSRF only.
- Authenticated and anonymous clients have separate cookie jars. Public MCP
  tools do not acquire account privileges merely because a session exists.
- `@napi-rs/keyring` accesses macOS Keychain / Windows Credential Manager /
  Linux Secret Service. Linux explicitly requires `secret-service`, preventing
  silent fallback to nonpersistent kernel keyutils. No plaintext fallback.
- One random 256-bit encryption key is stored in the OS vault under service
  `aurorarepos-mcp`, account `session-key-v1-default`. The bounded cookie payload
  is AES-256-GCM encrypted with random 96-bit nonce, 128-bit tag and fixed AAD
  binding it to version/profile/origin. Encryption uses Node's `node:crypto`.
- `env-paths` selects the user's local data directory on all three OSes.
  Only encrypted session data is stored there. POSIX directory/file modes
  are 0700/0600; Windows relies on the user's local data-directory ACL and
  encryption. Refuse symlink targets, bound reads, atomically replace files
  and reject concurrent writes with a lock. Do not overwrite corrupt sessions.
- Vault unavailable/locked is an error, not "logged out". 401 indicates an
  expired/invalid session; 403 indicates denied access, not necessarily expiry.
  No password is available for automatic relogin. Network errors cannot
  establish that a session has expired.

Native keyring write/read/delete was checked on Linux using a random test
entry that was deleted afterward. macOS/Windows require their own opt-in
native tests; mocked CI tests alone do not verify OS vault integration.

Sources: [login frontend](https://aurorarepos.ru/js/app.js),
[developer frontend](https://aurorarepos.ru/js/439.js),
[keyring](https://github.com/Brooooooklyn/keyring-node).
