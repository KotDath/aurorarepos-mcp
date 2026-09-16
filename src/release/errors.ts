const messages = {
  FILE_ACCESS_DISABLED: 'Local RPM reads are disabled. Configure dedicated allowed directories in the server environment.',
  INVALID_FILE_POLICY: 'Invalid local RPM directory policy. Ask the server operator to check its configuration.',
  FILE_NOT_ALLOWED: 'RPM path is not allowed, is linked, or is not a regular local .rpm file.',
  FILE_READ_FAILED: 'Unable to read the permitted RPM file.',
  FILE_TOO_LARGE: 'RPM exceeds the 256 MiB per-file preflight limit.',
  FILE_CHANGED: 'RPM file or its directory changed during preparation. Retry after the build finishes.',
  INVALID_RPM: 'Malformed, truncated or structurally inconsistent RPM.',
  UNSUPPORTED_RPM: 'Unsupported RPM format, OS, architecture or payload encoding.',
  PACKAGE_MISMATCH: '32-bit and 64-bit RPMs must have matching name, epoch, version and release.',
  INVALID_RELEASE_INPUT: 'Invalid release preparation arguments.',
} as const;
export class ReleaseError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'ReleaseError'; }
}
