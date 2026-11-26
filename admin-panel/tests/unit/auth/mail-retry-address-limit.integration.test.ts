import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
/**
 * The daily per-address mail limit holds for mails delivered by the retry queue too: a post-payment
 * link parked past the limit waits until the next day instead of being lost or sent on the same day.
 * Real local database and real rate limiter; only the auth mailer and the purchase lookup are simulated.
 * @see src/lib/auth/magic-link/retry.ts
 * @see src/lib/auth/magic-link/request.ts
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deliverMagicLink = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const eventMailForSlug = vi.hoisted(() => vi.fn());
vi.mock('@/lib/events/mail', () => ({ eventMailForSlug }));
vi.mock('@/lib/embed/checkout-embed', () => ({ getSellfBaseUrl: () => 'https://shop.example.com' }));

import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { runAuthMailRetries } from '@/lib/auth/magic-link/retry';
import { addressMailRetryAfterSeconds } from '@/lib/auth/magic-link/address-limit';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const run = crypto.randomUUID().slice(0, 8);
const emails: string[] = [];
const redirectTo = buildPostCheckoutMagicLinkRedirect({ origin: 'https://shop.example.com', productSlug: 'course', locale: 'pl', sessionId: undefined, paymentIntentId: undefined });
const purchase = { purchase_product: 'Course', purchase_amount: '10 PLN' };
// The worker claims every due row in the shared database: count only this test's own address.
const callsFor = (email: string) => deliverMagicLink.mock.calls.filter(([input]) => input.email === email);
const otherLink = (email: string, i: number) => sendTrustedMagicLink({ retry: 'post_checkout', email, data: { ...purchase, locale: 'pl' },
  redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: 'https://shop.example.com', productSlug: `other-${i}`, locale: 'pl', sessionId: undefined, paymentIntentId: undefined }) });
const paidLink = (email: string) => sendTrustedMagicLink({ retry: 'post_checkout', email, redirectTo, data: { ...purchase, locale: 'pl' } });

beforeEach(() => {
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('RATE_LIMIT_TEST_MODE', 'true');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  deliverMagicLink.mockReset().mockResolvedValue({ ok: true });
  eventMailForSlug.mockReset().mockResolvedValue(purchase);
});
afterAll(async () => {
  await db.from('auth_mail_retries').delete().in('email', emails);
  vi.unstubAllEnvs();
});

describe('daily per-address limit on queued purchase mails @J292', () => {
  it('a link parked past the limit is not delivered on the same day and stays queued for the next day @J292', async () => {
    const email = `retry-limit-${run}@example.com`; emails.push(email);
    // Five links for other purchases use up the inbox's daily limit.
    for (let i = 0; i < 5; i++) expect(await otherLink(email, i)).toEqual({ ok: true });
    const parked = await paidLink(email);
    // The page is told when the inbox limit lets the queued link out, not "within minutes" (U3).
    expect(parked).toEqual({ ok: false, code: 'rate_limited', queued: true, retryAfterSeconds: expect.any(Number) });
    const retryAfter = (parked as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(Math.abs(retryAfter - addressMailRetryAfterSeconds())).toBeLessThanOrEqual(5);
    expect(callsFor(email)).toHaveLength(5);

    await db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('email', email);
    await runAuthMailRetries(db);

    expect(callsFor(email)).toHaveLength(5);
    // The delivered links left sent markers (W336); the parked link is the row for its own redirect.
    const row = (await db.from('auth_mail_retries').select('*').eq('email', email).eq('redirect_to', redirectTo).single()).data!;
    expect(row).toMatchObject({ given_up_at: null, attempts: 0, last_error: 'rate_limited' });
    // The queue waits exactly until the limit window the page announced, not a fresh 24 hours.
    expect(Math.abs(new Date(row.next_attempt_at).getTime() - (Date.now() + retryAfter * 1000))).toBeLessThanOrEqual(10_000);
  });

  it('a purchase whose link already reached the inbox is not parked past the limit nor sent the next day (U3)', async () => {
    const email = `retry-limit-same-${run}@example.com`; emails.push(email);
    for (let i = 0; i < 5; i++) expect(await paidLink(email)).toEqual({ ok: true });
    expect(await paidLink(email)).toEqual({ ok: true, skipped: true });
    await db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('email', email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(5);
    expect((await db.from('auth_mail_retries').select('id').eq('email', email).is('given_up_at', null)).data).toEqual([]);
  });
});
