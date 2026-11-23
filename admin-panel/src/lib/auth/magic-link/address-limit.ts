/**
 * Daily limit of sign-in mails per inbox (address variants a provider delivers to one inbox share
 * it). Interactive requests and deliveries from the retry queue count against the same limit.
 * @see src/lib/auth/magic-link/request.ts
 * @see src/lib/auth/magic-link/retry.ts
 */
import 'server-only';

import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { canonicalizeEmailForBucket } from '@/lib/security/email-canonical';

export const ADDRESS_MAIL_WINDOW_MINUTES = 1440;

/** Counts one mail to `email`; false when its inbox already got the daily maximum. */
export function allowMailToAddress(email: string): Promise<boolean> {
  return checkRateLimitForIdentifier('magic_link_email', 5, ADDRESS_MAIL_WINDOW_MINUTES, `email:${canonicalizeEmailForBucket(email)}`);
}

export function addressMailRetryAfterSeconds(): number {
  const window = ADDRESS_MAIL_WINDOW_MINUTES * 60;
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? window : window - Math.floor(Date.now() / 1000) % window;
}
