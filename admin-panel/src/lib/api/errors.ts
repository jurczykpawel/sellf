/**
 * Shared API error classes.
 *
 * Extracted here (rather than left in `./middleware`) so that other modules
 * in `lib/api/*` — notably `api-keys.ts` — can throw typed validation errors
 * without creating a cycle with `middleware.ts`, which imports from
 * `api-keys.ts`. `middleware.ts` continues to re-export both classes for
 * backwards compatibility with existing route handlers.
 */

export class ApiAuthError extends Error {
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_TOKEN' | 'RATE_LIMITED';

  constructor(code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_TOKEN' | 'RATE_LIMITED', message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiAuthError';
  }
}

export class ApiValidationError extends Error {
  details?: Record<string, string[]>;

  constructor(message: string, details?: Record<string, string[]>) {
    super(message);
    this.details = details;
    this.name = 'ApiValidationError';
  }
}
