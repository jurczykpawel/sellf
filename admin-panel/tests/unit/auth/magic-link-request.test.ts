import { describe, it, expect, vi, beforeEach } from 'vitest';

const deliverMagicLink = vi.hoisted(() => vi.fn());
const verifyCaptchaToken = vi.hoisted(() => vi.fn());
const validateEmailAction = vi.hoisted(() => vi.fn());
const checkRateLimitForIdentifier = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimitForIdentifier }));
vi.mock('@/lib/embed/checkout-embed', () => ({
  getSellfBaseUrl: () => 'https://shop.example.com',
}));

import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { buildLoginMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';

const BASE_INPUT = {
  email: 'Buyer@Example.com',
  captchaToken: 'good-token',
  flow: 'login' as const,
  ip: '1.2.3.4',
};

describe('requestMagicLink', () => {
  beforeEach(() => {
    deliverMagicLink.mockReset();
    verifyCaptchaToken.mockReset();
    validateEmailAction.mockReset();
    checkRateLimitForIdentifier.mockReset();

    deliverMagicLink.mockResolvedValue({ ok: true });
    verifyCaptchaToken.mockResolvedValue({ success: true });
    validateEmailAction.mockResolvedValue({ isValid: true, isDisposable: false });
    checkRateLimitForIdentifier.mockResolvedValue(true);
  });

  it('checks the IP rate limit first, before captcha', async () => {
    checkRateLimitForIdentifier.mockResolvedValueOnce(false);

    const result = await requestMagicLink(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: 'rate_limited' });
    expect(checkRateLimitForIdentifier).toHaveBeenCalledWith(
      'magic_link_ip',
      5,
      15,
      'ip:1.2.3.4',
    );
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

  it('delivers a login magic link with shouldCreateUser true and the login redirect', async () => {
    const result = await requestMagicLink({ ...BASE_INPUT, flow: 'login' });

    expect(result).toEqual({ ok: true });
    expect(deliverMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'Buyer@Example.com',
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
