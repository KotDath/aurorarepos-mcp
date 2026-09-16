const messages = {
  APPROVAL_INVALID: 'Write confirmation is missing, expired, modified or already used. Request a fresh confirmation.',
  APPROVAL_DECLINED: 'The user declined or cancelled this write. No mutation was sent.',
  APPROVAL_BUSY: 'Too many pending write confirmations. Finish or wait for existing confirmations.',
  WRITE_SESSION_CHANGED: 'The saved account session changed after the preview. No mutation was sent.',
  WRITE_STATE_CHANGED: 'The application/catalog changed after the preview. No mutation was sent; request a fresh confirmation.',
  APP_NAME_EXISTS: 'An owned application already has this name. No mutation was sent.',
  WRITE_ALREADY_ATTEMPTED: 'This write was already attempted, possibly in another process. Inspect the site with read tools; do not automatically resend.',
  WRITE_JOURNAL_UNAVAILABLE: 'The local write-attempt journal is unavailable or full. No mutation was sent.',
  WRITE_OUTCOME_UNKNOWN: 'The write may have reached Aurora Repos, but its result could not be verified. Inspect using read tools; do not automatically retry.',
  INVALID_WRITE_INPUT: 'Invalid application write arguments.',
  RELEASE_EXISTS: 'This app already has a release with this version, release and OS. No upload was sent.',
  RELEASE_FILE_CHANGED: 'RPM bytes or metadata changed after confirmation. No upload was sent.',
  EDITOR_CONTRACT_UNVERIFIED: 'Required editor fields or their preservation semantics could not be established. No mutation was sent.',
  RELEASE_TARGET_MISMATCH: 'The RPM package name does not match existing package metadata for this application. No upload was sent.',
} as const;
export class WriteError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'WriteError'; }
}
