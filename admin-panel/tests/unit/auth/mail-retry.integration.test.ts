import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
/**
 * A purchase mail refused by the auth mailer (send limit, cooldown) is retried by cron instead of
 * being lost (W147-8, W147-9). Real local database; only the auth mailer call is simulated.
 * @see supabase/migrations/20261110235907_release_2026_11_0_attribution_mail_analytics.sql
 * @see src/lib/auth/magic-link/retry.ts
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deliverMagicLink = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: async () => ({ success: true }) }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction: async () => ({ isValid: true }) }));
vi.mock('@/lib/events/mail', () => ({ eventMailForSlug: async () => ({ purchase_product: 'Course', purchase_amount: '10 PLN' }) }));
vi.mock('@/lib/embed/checkout-embed', () => ({ getSellfBaseUrl: () => 'https://shop.example.com' }));

import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { runAuthMailRetries, AUTH_MAIL_MAX_ATTEMPTS } from '@/lib/auth/magic-link/retry';
import { sendLicenseMail } from '@/lib/license-keys/license-mail';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const run = crypto.randomUUID().slice(0, 8);
const emails: string[] = [];
const rows = (email: string) => db.from('auth_mail_retries').select('*').eq('email', email);
const due = (email: string) => db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('email', email);
const paidLink = (email: string) => requestMagicLink({ email, captchaToken: 'ok', flow: 'post_checkout', productSlug: 'course', locale: 'pl' });

beforeEach(() => { vi.stubEnv('DEMO_MODE', 'false'); deliverMagicLink.mockReset(); });
afterAll(async () => { await db.from('auth_mail_retries').delete().in('email', emails); vi.unstubAllEnvs(); });

describe('auth mail retry @J292', () => {
  it('parks a post-payment link refused by the send limit and delivers it on the next cron run @J292', async () => {
    const email = `retry-paid-${run}@example.com`; emails.push(email);
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'rate_limited' });
    expect(await paidLink(email)).toEqual({ ok: false, code: 'rate_limited', queued: true });
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'rate_limited' });
    await paidLink(email);
    const parked = (await rows(email)).data!;
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ kind: 'post_checkout', attempts: 0, last_error: 'rate_limited' });
    expect(new Date(parked[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    await due(email);
    deliverMagicLink.mockResolvedValue({ ok: true });
    await runAuthMailRetries(db);
    expect(deliverMagicLink).toHaveBeenLastCalledWith(expect.objectContaining({ email, redirectTo: parked[0].redirect_to, data: parked[0].data }));
    expect((await rows(email)).data).toEqual([]);
  });

  it('backs off after each refusal and gives up after the last attempt @J292', async () => {
    const email = `retry-backoff-${run}@example.com`; emails.push(email);
    deliverMagicLink.mockResolvedValue({ ok: false, code: 'rate_limited' });
    await paidLink(email);
    for (let i = 1; i <= AUTH_MAIL_MAX_ATTEMPTS; i++) {
      await due(email);
      await runAuthMailRetries(db);
      const [row] = (await rows(email)).data!;
      expect(row.attempts).toBe(i);
      if (i < AUTH_MAIL_MAX_ATTEMPTS) {
        expect(row.given_up_at).toBeNull();
        expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 60_000);
      } else expect(row.given_up_at).not.toBeNull();
    }
  });

  it('does not park interactive login links (the visitor sees the error and retries)', async () => {
    const email = `retry-login-${run}@example.com`; emails.push(email);
    deliverMagicLink.mockResolvedValue({ ok: false, code: 'rate_limited' });
    expect(await requestMagicLink({ email, captchaToken: 'ok', flow: 'login', locale: 'pl' })).toEqual({ ok: false, code: 'rate_limited' });
    expect((await rows(email)).data).toEqual([]);
  });

  it('parks a refused key and discards it if the license is no longer present @J291', async () => {
    const email = `retry-license-${run}@example.com`; emails.push(email);
    const user = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { locale: 'pl' } });
    expect(user.error).toBeNull();
    try {
      deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'rate_limited' });
      await sendLicenseMail(db, { userId: user.data.user!.id, email, productSlug: 'kit', productName: 'Kit', token: 'payload.signature' });
      const [row] = (await rows(email)).data!;
      expect(row).toMatchObject({ kind: 'license', data: expect.objectContaining({ license_key: 'payload.signature', locale: 'pl' }) });
      await due(email);
      deliverMagicLink.mockResolvedValue({ ok: true });
      deliverMagicLink.mockClear();
      await runAuthMailRetries(db);
      expect(deliverMagicLink).not.toHaveBeenCalled();
      expect((await rows(email)).data).toEqual([]);
      const meta = (await db.auth.admin.getUserById(user.data.user!.id)).data.user!.user_metadata;
      expect(meta.license_key).toBeUndefined();
    } finally {
      await db.auth.admin.deleteUser(user.data.user!.id);
    }
  });
});
