# Live new-release upload — 2026-09-16

Explicit user target: existing OpenTranslator app, Russian title «Открытый
Переводчик», owned card 290, prior published release 853 (1.0.0-1), Aurora 5.
User rebuilt and selected the release RPMs. Fresh out-of-band terminal login was
verified, followed by exact user confirmation of target, files/hashes and notes.
No passwords, cookies, CSRF tokens or private contacts are recorded here.

`upload_release` dispatched ONE `POST /api/application` multipart request and
reconciled NEW release 870, version 1.0.1-1, status code 3 / `published`.
No separate review/publication endpoint or admin capability was invoked.

| Slot | Local release RPM | Bytes | Server/local SHA-256 |
| --- | --- | ---: | --- |
| rpm32 | ru.kotdath.OpenTranslator-1.0.1-1.armv7hl.rpm | 6160763 | 621f6b527ace9e5baf84cfa27d4bd4de4291d25e01eac3ed195e05c0a2ac42fd |
| rpm64 | ru.kotdath.OpenTranslator-1.0.1-1.aarch64.rpm | 6858163 | a0e0e40ad714f19306fe3dbd16e2218f6ee3a89ef8250963c46f1e3f825f5f24 |

Shared description, category, contacts, owner, icon, screenshots, beta and schedule
were unchanged under the reconciliation checks. Notes state that the delete-model
button now immediately clears text/translation and retains the downloaded model.
The successful duplicate-attempt marker was retained outside Git; no retry/reset.

An isolated anonymous `get_app` read independently returned public version 1.0.1,
release 870, both matching digests, notes and the existing screenshot.
[Public card](https://aurorarepos.ru/aurora-5/otkrytyi-perevodcik),
[32-bit RPM](https://aurorarepos.ru/download/ru.kotdath.OpenTranslator-1.0.1-1.armv7hl-aur5.rpm),
[64-bit RPM](https://aurorarepos.ru/download/ru.kotdath.OpenTranslator-1.0.1-1.aarch64.rpm).
Public filename normalization adds `-aur5` to the 32-bit download name; bytes/hash
still match the selected local RPM.

This verifies one new-release upload on one configured app. It does NOT verify
RPM signatures/payload/installability, other status transitions, live app-card or
metadata edits, server timezone/delayed publication, image/contact/beta mutations,
native macOS/Windows vaults or hosted CI. No npm release or Git push was made.
