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

import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { requestMagicLink, sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
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
const schedule = (email: string, locale: 'pl' | 'en' = 'pl', order = `pi_${email}`) => scheduleGuestAccessMail(db, { email, productSlug: 'course', locale, order });
// The one-hour window that covers a recent link has passed: only the order itself can still match.
const ageMarkers = (email: string) => db.from('auth_mail_retries').update({ given_up_at: new Date(Date.now() - 2 * 3600_000).toISOString() }).eq('email', email).not('given_up_at', 'is', null);
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
    // The delivered link stays as a sent marker for this order, not a pending mail.
    expect((await rows(email)).data!.filter(row => row.given_up_at === null)).toEqual([]);
  });

  it('a delivered access link is not scheduled again when the same order is retried later (W336r P2-1)', async () => {
    const email = newEmail('order-retry');
    expect(await schedule(email, 'pl', 'pi_retry')).toBe(true);
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
    await ageMarkers(email);
    // Stripe redelivers the payment because fulfillment failed after the link was scheduled.
    expect(await schedule(email, 'pl', 'pi_retry')).toBe(false);
    expect(await schedule(email, 'en', 'pi_retry')).toBe(false);
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
    // A new order of the same product is a new purchase and gets its own link.
    expect(await schedule(email, 'pl', 'pi_next')).toBe(true);
  });

  it('a link the page sent before the order was recorded covers a late retry of that order (W336r P2-1)', async () => {
    const email = newEmail('page-then-late-retry');
    expect(await pageLink(email)).toEqual({ ok: true });
    expect(await schedule(email, 'en', 'pi_late')).toBe(false);
    await ageMarkers(email);
    expect(await schedule(email, 'en', 'pi_late')).toBe(false);
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
  });

  it('a page link in another language cancels the scheduled mail (W336r P2-2)', async () => {
    const email = newEmail('locale-switch');
    expect(await schedule(email, 'en')).toBe(true);
    expect(await pageLink(email, 'pl')).toEqual({ ok: true });
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(1);
  });

  it('a page link parked by the send limit is due on its own short retry, not after the return window (W336r P3-1)', async () => {
    const email = newEmail('page-parked');
    expect(await schedule(email)).toBe(true);
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'rate_limited' });
    expect(await pageLink(email)).toMatchObject({ ok: false, queued: true });
    const parked = (await rows(email)).data!;
    expect(parked).toHaveLength(1);
    expect(Date.parse(parked[0].next_attempt_at)).toBeLessThanOrEqual(Date.now() + 3 * 60_000);
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(2);
    expect((await rows(email)).data!.filter(row => row.given_up_at === null)).toEqual([]);
  });

  it('a purchase that cannot be read yet keeps the scheduled link for the next attempt (W336r P3-2)', async () => {
    const email = newEmail('pending-read');
    expect(await schedule(email)).toBe(true);
    eventMailForSlug.mockResolvedValue({ purchase_mail_pending: 'true' });
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(0);
    expect((await rows(email)).data).toHaveLength(1);
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

  it('a link the server page parked is not delivered after the buyer got the link from the page (U3)', async () => {
    const email = newEmail('server-parked-then-page');
    // The confirmation page's server-side send is refused by the auth mailer and parked.
    const serverRedirect = buildPostCheckoutMagicLinkRedirect({ origin: 'https://shop.example.com', productSlug: 'course', locale: 'pl', sessionId: 'cs_test_u3', paymentIntentId: undefined });
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'rate_limited' });
    expect(await sendTrustedMagicLink({ retry: 'post_checkout', email, redirectTo: serverRedirect, data: { purchase_product: 'Course', locale: 'pl' } }))
      .toMatchObject({ ok: false, queued: true });
    // A moment later the page's own request delivers the link.
    expect(await pageLink(email)).toEqual({ ok: true });
    expect(callsFor(email)).toHaveLength(2);
    await due(email);
    await runAuthMailRetries(db);
    expect(callsFor(email)).toHaveLength(2);
    expect((await rows(email)).data!.filter(row => row.given_up_at === null)).toEqual([]);
  });

  it('a page refresh during the mailer cooldown after a delivered link neither reopens the sent marker nor sends a second mail (C-B3)', async () => {
    const email = newEmail('refresh-cooldown');
    expect(await schedule(email)).toBe(true);
    expect(await pageLink(email)).toEqual({ ok: true });
    // Refresh within 60 s (and the English URL): the auth mailer refuses the repeat with its cooldown.
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'rate_limited' }).mockResolvedValueOnce({ ok: false, code: 'rate_limited' });
    expect(await pageLink(email)).toEqual({ ok: true, skipped: true });
    expect(await pageLink(email, 'en')).toEqual({ ok: true, skipped: true });
    expect((await rows(email)).data!.filter(row => row.given_up_at === null)).toEqual([]);
    await due(email);
    await runAuthMailRetries(db);
    // One delivered link and the two refused repeats; the queue sends nothing more.
    expect(callsFor(email)).toHaveLength(3);
  });

  it('the queue function keeps a sent post-payment marker closed when the same link is parked again (C-B3)', async () => {
    const email = newEmail('marker-requeue');
    expect(await pageLink(email)).toEqual({ ok: true });
    const marker = (await rows(email)).data!.find(row => row.last_error === 'sent')!;
    const { error } = await db.rpc('queue_auth_mail_retry', { p_email: email, p_redirect_to: marker.redirect_to, p_data: { locale: 'pl' }, p_kind: 'post_checkout', p_error: 'rate_limited' });
    expect(error).toBeNull();
    const after = (await rows(email)).data!.find(row => row.id === marker.id)!;
    expect(after).toMatchObject({ last_error: 'sent' });
    expect(after.given_up_at).not.toBeNull();
  });
});
