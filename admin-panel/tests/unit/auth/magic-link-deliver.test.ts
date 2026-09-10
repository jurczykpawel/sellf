import { describe, it, expect, vi, beforeEach } from 'vitest';

const signInWithOtp = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { signInWithOtp } }),
}));

import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';

describe('deliverMagicLink', () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
  });

  it('calls signInWithOtp with the expected payload and returns ok on success', async () => {
    signInWithOtp.mockResolvedValue({ error: null });

    const result = await deliverMagicLink({
      email: 'buyer@example.com',
      redirectTo: 'https://shop.example.com/auth/callback',
      shouldCreateUser: true,
      data: { product_slug: 'widget' },
    });

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      options: {
        shouldCreateUser: true,
        emailRedirectTo: 'https://shop.example.com/auth/callback',
        data: { product_slug: 'widget' },
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it('maps a rate-limit error to rate_limited', async () => {
    signInWithOtp.mockResolvedValue({
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'x' },
    });

    const result = await deliverMagicLink({
      email: 'buyer@example.com',
      redirectTo: 'https://shop.example.com/auth/callback',
      shouldCreateUser: true,
    });

    expect(result).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('maps any other error to send_failed and logs without the email', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    signInWithOtp.mockResolvedValue({
      error: { status: 500, code: 'unexpected_failure', message: 'boom' },
    });

    const result = await deliverMagicLink({
      email: 'buyer@example.com',
      redirectTo: 'https://shop.example.com/auth/callback',
      shouldCreateUser: false,
    });

    expect(result).toEqual({ ok: false, code: 'send_failed' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [loggedMessage] = errorSpy.mock.calls[0];
    expect(loggedMessage).toContain('[magic-link]');
    expect(loggedMessage).toContain('unexpected_failure');
    expect(loggedMessage).not.toContain('buyer@example.com');

    errorSpy.mockRestore();
  });

  it('maps a thrown exception to send_failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    signInWithOtp.mockRejectedValue(new Error('network down'));

    const result = await deliverMagicLink({
      email: 'buyer@example.com',
      redirectTo: 'https://shop.example.com/auth/callback',
      shouldCreateUser: true,
    });

    expect(result).toEqual({ ok: false, code: 'send_failed' });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
