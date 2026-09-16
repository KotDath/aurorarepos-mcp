const messages = {
  FILE_NOT_ALLOWED: 'Expected an absolute path to a regular .rpm file.',
  FILE_READ_FAILED: 'Unable to read the RPM file.',
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
