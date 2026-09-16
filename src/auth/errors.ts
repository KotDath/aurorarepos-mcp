import { AuroraError } from '../aurora/errors.js';

export type AuthErrorCode = 'STORAGE_UNAVAILABLE' | 'SESSION_INVALID' | 'STORAGE_BUSY' | 'AUTH_FAILED' | 'TWO_FACTOR_FAILED' | 'INTERACTIVE_REQUIRED';
const messages: Record<AuthErrorCode, string> = {
  STORAGE_UNAVAILABLE: 'Secure storage is unavailable or locked. Unlock/configure the OS vault. No plaintext fallback is used.',
  SESSION_INVALID: 'The saved session is invalid or cannot be decrypted. It was not overwritten. Use auth logout to remove it locally.',
  STORAGE_BUSY: 'Another process is updating the session. Retry after it finishes. A stale session.lock needs manual review.',
  AUTH_FAILED: 'Login was not verified. Check credentials and try again manually; no session was saved.',
  TWO_FACTOR_FAILED: 'Two-factor verification failed. Retry login manually; no session was saved.',
  INTERACTIVE_REQUIRED: 'Login requires an interactive terminal. Credentials are not accepted through arguments, environment variables or pipes.',
};
export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) { super(messages[code]); this.name = 'AuthError'; }
}
export function safeAuthError(error: unknown): AuthError | AuroraError {
  return error instanceof AuthError || error instanceof AuroraError ? error : new AuthError('STORAGE_UNAVAILABLE');
}
