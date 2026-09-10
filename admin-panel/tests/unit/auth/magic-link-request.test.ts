import { describe, it, expect, vi, beforeEach } from 'vitest';

const deliverMagicLink = vi.hoisted(() => vi.fn());
const verifyCaptchaToken = vi.hoisted(() => vi.fn());
const validateEmailAction = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const checkRateLimitForIdentifier = vi.hoisted(() => vi.fn());
const queuePendingFreeGrant = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink }));
vi.mock('@/lib/services/pending-free-grants', () => ({ queuePendingFreeGrant }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit, checkRateLimitForIdentifier }));
vi.mock('@/lib/embed/checkout-embed', () => ({
  getSellfBaseUrl: () => 'https://shop.example.com',
}));

import { requestMagicLink, sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildLoginMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';

const BASE_INPUT = {
  email: 'Buyer@Example.com',
  captchaToken: 'good-token',
  flow: 'login' as const,
};

describe('requestMagicLink', () => {
  beforeEach(() => {
    deliverMagicLink.mockReset();
    verifyCaptchaToken.mockReset();
    validateEmailAction.mockReset();
    checkRateLimit.mockReset();
    checkRateLimitForIdentifier.mockReset();
    queuePendingFreeGrant.mockReset();

    deliverMagicLink.mockResolvedValue({ ok: true });
    verifyCaptchaToken.mockResolvedValue({ success: true });
    validateEmailAction.mockResolvedValue({ isValid: true, isDisposable: false });
    checkRateLimit.mockResolvedValue(true);
    checkRateLimitForIdentifier.mockResolvedValue(true);
  });

  it('checks the IP rate limit first, before captcha', async () => {
    checkRateLimit.mockResolvedValueOnce(false);

    const result = await requestMagicLink(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: 'rate_limited' });
    expect(checkRateLimit).toHaveBeenCalledWith('magic_link_ip', 5, 15);
    expect(verifyCaptchaToken).not.toHaveBeenCalled();
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('returns captcha_failed and never calls deliver when captcha verification fails', async () => {
    verifyCaptchaToken.mockResolvedValueOnce({ success: false, error: 'nope' });

    const result = await requestMagicLink(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: 'captcha_failed' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('returns invalid_email and never calls deliver when the email is invalid', async () => {
    validateEmailAction.mockResolvedValueOnce({ isValid: false, isDisposable: false });

    const result = await requestMagicLink(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: 'invalid_email' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('checks the per-email rate limit with a lowercased identifier', async () => {
    checkRateLimitForIdentifier.mockImplementation(async (action: string) =>
      action === 'magic_link_email' ? false : true,
    );

    const result = await requestMagicLink(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: 'rate_limited' });
    expect(checkRateLimitForIdentifier).toHaveBeenCalledWith(
      'magic_link_email',
      5,
      1440,
      'email:buyer@example.com',
    );
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('delivers a login magic link with shouldCreateUser true, the login redirect, and a trimmed lowercased email', async () => {
    const result = await requestMagicLink({ ...BASE_INPUT, flow: 'login' });

    expect(result).toEqual({ ok: true });
    expect(deliverMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
        redirectTo: buildLoginMagicLinkRedirect('https://shop.example.com'),
        shouldCreateUser: true,
      }),
    );
  });

  it('delivers a free_product magic link with the free-product redirect and product_slug data', async () => {
    const result = await requestMagicLink({
      ...BASE_INPUT,
      flow: 'free_product',
      productSlug: 'widget',
      couponCode: 'SAVE10',
      successUrl: 'https://seller.example.com/thanks',
    });

    expect(result).toEqual({ ok: true });
    expect(deliverMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo:
          'https://shop.example.com/auth/callback?redirect_to=' +
          encodeURIComponent(
            '/auth/product-access?product=widget&coupon=SAVE10&success_url=https%3A%2F%2Fseller.example.com%2Fthanks',
          ),
        data: { product_slug: 'widget' },
      }),
    );
  });

  it('delivers a post_checkout magic link with the post-checkout redirect', async () => {
    const result = await requestMagicLink({
      ...BASE_INPUT,
      flow: 'post_checkout',
      productSlug: 'widget',
    });

    expect(result).toEqual({ ok: true });
    expect(deliverMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo:
          'https://shop.example.com/auth/callback?redirect_to=' +
          encodeURIComponent('/auth/product-access?product=widget'),
      }),
    );
  });

  it('rejects free_product without a productSlug', async () => {
    const result = await requestMagicLink({ ...BASE_INPUT, flow: 'free_product' });

    expect(result).toEqual({ ok: false, code: 'invalid_request' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('remembers the requested free product after the link is sent, so any later sign-in grants it', async () => {
    await requestMagicLink({ ...BASE_INPUT, flow: 'free_product', productSlug: 'widget' });

    expect(queuePendingFreeGrant).toHaveBeenCalledWith('buyer@example.com', 'widget');
  });

  it('does not remember the free product when the link could not be sent', async () => {
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'send_failed' });

    await requestMagicLink({ ...BASE_INPUT, flow: 'free_product', productSlug: 'widget' });

    expect(queuePendingFreeGrant).not.toHaveBeenCalled();
  });

  it('never queues a grant for login or post_checkout links', async () => {
    await requestMagicLink({ ...BASE_INPUT, flow: 'login' });
    await requestMagicLink({ ...BASE_INPUT, flow: 'post_checkout', productSlug: 'widget' });

    expect(queuePendingFreeGrant).not.toHaveBeenCalled();
  });

  it('rejects post_checkout without a productSlug', async () => {
    const result = await requestMagicLink({ ...BASE_INPUT, flow: 'post_checkout' });

    expect(result).toEqual({ ok: false, code: 'invalid_request' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('always builds the redirect from the server base URL, never from input', async () => {
    await requestMagicLink(BASE_INPUT);

    const call = deliverMagicLink.mock.calls[0][0];
    expect(call.redirectTo.startsWith('https://shop.example.com/')).toBe(true);
  });
});

describe('sendTrustedMagicLink', () => {
  beforeEach(() => {
    deliverMagicLink.mockReset();
    checkRateLimitForIdentifier.mockReset();
    deliverMagicLink.mockResolvedValue({ ok: true });
    checkRateLimitForIdentifier.mockResolvedValue(true);
  });

  it('rate limits per trimmed lowercased email before delivering', async () => {
    checkRateLimitForIdentifier.mockResolvedValueOnce(false);

    const result = await sendTrustedMagicLink({
      email: ' Buyer@Example.com ',
      redirectTo: 'https://shop.example.com/auth/callback?flow=login',
    });

    expect(result).toEqual({ ok: false, code: 'rate_limited' });
    expect(checkRateLimitForIdentifier).toHaveBeenCalledWith(
      'magic_link_email',
      5,
      1440,
      'email:buyer@example.com',
    );
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('delivers with the trimmed lowercased email once the 6th call in the same window is blocked', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await sendTrustedMagicLink({
        email: 'buyer@example.com',
        redirectTo: 'https://shop.example.com/auth/callback?flow=login',
      });
      expect(result).toEqual({ ok: true });
    }

    checkRateLimitForIdentifier.mockResolvedValueOnce(false);
    const sixth = await sendTrustedMagicLink({
      email: 'buyer@example.com',
      redirectTo: 'https://shop.example.com/auth/callback?flow=login',
    });

    expect(sixth).toEqual({ ok: false, code: 'rate_limited' });
    expect(deliverMagicLink).toHaveBeenCalledTimes(5);
  });
});
