/**
 * Shared email format check for every public-facing endpoint that only
 * needs a cheap syntax sanity check (not full RFC validation — that's
 * `DisposableEmailService` / Zod's `.email()` elsewhere).
 *
 * The regex itself is fine, but running it on an unbounded string lets a
 * caller pay a growing amount of server CPU per request just by sending a
 * longer input. RFC 5321 caps a mailbox at 254 characters, so anything
 * longer is rejected before it ever reaches the regex.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH = 254;

export function isValidEmailFormat(email: string, maxLength = MAX_EMAIL_LENGTH): boolean {
  if (typeof email !== 'string' || email.length === 0 || email.length > maxLength) {
    return false;
  }
  return EMAIL_REGEX.test(email);
}
