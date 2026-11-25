/**
 * A paying guest who never comes back from the payment page still gets the first access link:
 * the paid order schedules it in auth_mail_retries, and a link sent by the confirmation page
 * first leaves a marker so the buyer gets one mail, not two (W336). Real local database; only
 * the auth mailer call and the purchase lookup are simulated.
 * @see src/lib/auth/magic-link/retry.ts
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deliverMagicLink = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: async () => ({ success: true }) }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction: async () => ({ isValid: true }) }));
const eventMailForSlug = vi.hoisted(() => vi.fn());
vi.mock('@/lib/events/mail', () => ({ eventMailForSlug }));
vi.mock('@/lib/embed/checkout-embed', () => ({ getSellfBaseUrl: () => 'https://shop.example.com' }));

import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { GUEST_ACCESS_MAIL_DELAY_MINUTES, runAuthMailRetries, scheduleGuestAccessMail } from '@/lib/auth/magic-link/retry';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const run = crypto.randomUUID().slice(0, 8);
const emails: string[] = [];
const rows = (email: string) => db.from('auth_mail_retries').select('*').eq('email', email);
const due = (email: string) => db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('email', email);
// The worker claims every due row in the shared database: count only this test's own address.
const callsFor = (email: string) => deliverMagicLink.mock.calls.filter(([input]) => input.email === email);
const lastCallFor = (email: string) => callsFor(email).at(-1)?.[0];
const pageLink = (email: string, locale = 'pl') => requestMagicLink({ email, captchaToken: 'ok', flow: 'post_checkout', productSlug: 'course', locale });
const schedule = (email: string, locale: 'pl' | 'en' = 'pl') => scheduleGuestAccessMail(db, { email, productSlug: 'course', locale });
const newEmail = (name: string) => { const email = `guest-access-${name}-${run}@example.com`; emails.push(email); return email; };

beforeEach(() => {
  vi.stubEnv('DEMO_MODE', 'false');
  deliverMagicLink.mockReset().mockResolvedValue({ ok: true });
  eventMailForSlug.mockReset().mockResolvedValue({ purchase_product: 'Course', purchase_amount: '10 PLN' });
});
afterAll(async () => { await db.from('auth_mail_retries').delete().in('email', emails); vi.unstubAllEnvs(); });

describe('first access mail for a guest who does not return (W336)', () => {
  it('a paid guest order schedules one access link that the cron delivers after the return window', async () => {
    const email = newEmail('no-return');
    const before = Date.now();
    expect(await schedule(email)).toBe(true);
    expect(await schedule(email)).toBe(false);
    const parked = (await rows(email)).data!;
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ kind: 'post_checkout', attempts: 0, given_up_at: null });
    expect(new Date(parked[0].next_attempt_at).getTime()).toBeGreaterThanOrEqual(before + (GUEST_ACCESS_MAIL_DELAY_MINUTES * 60_000) - 5_000);
    expect(new URL(parked[0].redirect_to).searchParams.get('redirect_to')).toBe('/pl/auth/product-access?product=course');

    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(0);

    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
    expect(lastCallFor(email)).toEqual(expect.objectContaining({ email, redirectTo: parked[0].redirect_to, shouldCreateUser: true,
      data: { locale: 'pl', purchase_product: 'Course', purchase_amount: '10 PLN' } }));
    expect((await rows(email)).data).toEqual([]);
  });

  it('a link already sent by the confirmation page is not sent again by the scheduled mail', async () => {
    const email = newEmail('page-first');
    expect(await pageLink(email)).toEqual({ ok: true });
    expect(callsFor(email)).toHaveLength(1);
    expect(await schedule(email)).toBe(false);
    // The page language may differ from the checkout language: still one mail per purchase.
    expect(await schedule(email, 'en')).toBe(false);
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
  });

  it('the confirmation page sending first after the order cancels the scheduled mail', async () => {
    const email = newEmail('page-later');
    expect(await schedule(email)).toBe(true);
    expect(await pageLink(email)).toEqual({ ok: true });
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
  });

  it('a scheduled link is dropped when the purchase is no longer completed (refund, dispute)', async () => {
    const email = newEmail('refunded');
    expect(await schedule(email)).toBe(true);
    eventMailForSlug.mockResolvedValue({});
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(0);
    expect((await rows(email)).data).toEqual([]);
  });

  it('a buyer with a confirmed account gets no scheduled link', async () => {
    const email = newEmail('confirmed');
    const user = await db.auth.admin.createUser({ email, email_confirm: true });
    expect(user.error).toBeNull();
    try {
      expect(await schedule(email)).toBe(false);
      expect((await rows(email)).data).toEqual([]);
    } finally {
      await db.auth.admin.deleteUser(user.data.user!.id);
    }
  });
});
