export type ErrorCode =
  | 'NOT_FOUND' | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'CSRF_REJECTED'
  | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_ERROR'
  | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'TIMEOUT' | 'CANCELLED'
  | 'NETWORK_ERROR' | 'BUSY' | 'INTERNAL_ERROR';

const messages: Record<ErrorCode, string> = {
  NOT_FOUND: 'Application or requested OS version was not found.',
  AUTH_REQUIRED: 'This endpoint unexpectedly requires authentication; the MVP is anonymous only.',
  ACCESS_DENIED: 'Aurora Repos denied access to this public operation.',
  CSRF_REJECTED: 'The guest session was rejected even after refreshing CSRF. Try again later.',
  RATE_LIMITED: 'Aurora Repos is rate limiting requests. Try again later.',
  UPSTREAM_UNAVAILABLE: 'Aurora Repos is temporarily unavailable. Try again later.',
  UPSTREAM_ERROR: 'Aurora Repos rejected the request.',
  INVALID_RESPONSE: 'Aurora Repos returned an incompatible response. Its internal API may have changed.',
  RESPONSE_TOO_LARGE: 'The upstream response exceeded the size limit. Narrow the query.',
  TIMEOUT: 'The request timed out. Try again later or narrow the query.',
  CANCELLED: 'The request was cancelled.',
  NETWORK_ERROR: 'Could not reach Aurora Repos. Check connectivity and try again later.',
  BUSY: 'Too many pending requests. Wait for existing requests to finish.',
  INTERNAL_ERROR: 'An internal error occurred. No upstream response or secrets are included.',
};

export class AuroraError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
    this.name = 'AuroraError';
  }
}

export function httpError(status: number): AuroraError {
  const codes: Record<number, ErrorCode> = {
    401: 'AUTH_REQUIRED', 403: 'ACCESS_DENIED', 404: 'NOT_FOUND',
    419: 'CSRF_REJECTED', 429: 'RATE_LIMITED',
    502: 'UPSTREAM_UNAVAILABLE', 503: 'UPSTREAM_UNAVAILABLE', 504: 'UPSTREAM_UNAVAILABLE',
  };
  return new AuroraError(codes[status] ?? 'UPSTREAM_ERROR');
}

export function sanitizedError(error: unknown): AuroraError {
  return error instanceof AuroraError ? error : new AuroraError('INTERNAL_ERROR');
}
