import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ enabled: false, throws: false, error: null as object | null, otp: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({
  from: () => ({ select: () => ({ maybeSingle: async () => { if (h.throws) throw new Error('Connection unavailable'); return { data: { supabase_buyer_emails: h.enabled }, error: h.error }; } }) }),
  rpc: h.rpc, auth: { signInWithOtp: h.otp },
}) }));
import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';
const input = { email: 'buyer@example.com', redirectTo: 'https://shop.example/auth/callback?flow=post_checkout', shouldCreateUser: true,
  data: { locale: 'pl', purchase_product: 'Workshop', license_key: 'key.token' } };
beforeEach(() => { vi.clearAllMocks(); h.enabled = false; h.throws = false; h.error = null; h.otp.mockResolvedValue({ error: null }); h.rpc.mockResolvedValue({ error: null }); });
it('keeps guest sign-in but removes order content when buyer emails are off', async () => {
  expect(await deliverMagicLink(input)).toEqual({ ok: true });
  expect(h.otp.mock.calls[0][0].options.data).toEqual({ locale: 'pl' });
  expect(h.rpc).toHaveBeenCalledWith('prepare_event_mail', { p_email: input.email, p_data: { locale: 'pl' } });
});
it('does not send a notification-only mail when buyer emails are off', async () => {
  expect(await deliverMagicLink({ ...input, transactionalOnly: true })).toEqual({ ok: true, skipped: true });
  expect(h.otp).not.toHaveBeenCalled();
});
it('preserves purchase mail content when enabled', async () => {
  h.enabled = true;
  await deliverMagicLink({ ...input, transactionalOnly: true });
  expect(h.otp.mock.calls[0][0].options.data).toEqual(input.data);
});
it('does not guess the setting when storage is unavailable', async () => {
  h.error = { message: 'unavailable' };
  expect(await deliverMagicLink({ ...input, transactionalOnly: true })).toEqual({ ok: false, code: 'send_failed' });
  expect(h.otp).not.toHaveBeenCalled();
});

it.each(['post_checkout', 'free_product', 'login'])('keeps %s sign-in available when the buyer email setting cannot be read', async flow => {
  h.error = { message: 'unavailable' };
  const redirectTo = `https://shop.example/auth/callback?flow=${flow}`;
  expect(await deliverMagicLink({ ...input, redirectTo })).toEqual({ ok: true });
  expect(h.otp).toHaveBeenCalledWith({ email: input.email, options: {
    shouldCreateUser: true, emailRedirectTo: redirectTo, data: { locale: 'pl' },
  } });
  expect(h.rpc).toHaveBeenCalledWith('prepare_event_mail', { p_email: input.email, p_data: { locale: 'pl' } });
});

it.each([false, true])('handles a rejected policy read for transactionalOnly=%s', async transactionalOnly => {
  h.throws = true;
  expect(await deliverMagicLink({ ...input, transactionalOnly })).toEqual(transactionalOnly ? { ok: false, code: 'send_failed' } : { ok: true });
  expect(h.otp).toHaveBeenCalledTimes(transactionalOnly ? 0 : 1);
  if (!transactionalOnly) expect(h.otp.mock.calls[0][0].options.data).toEqual({ locale: 'pl' });
});
