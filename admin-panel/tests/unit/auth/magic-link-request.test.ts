import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const policyRetry = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, code: 'send_failed' as const, queued: true as const })));
vi.mock('@/lib/auth/magic-link/retry', () => ({ queueAuthMailRetry: policyRetry }));
const buyerPolicy = vi.hoisted(() => vi.fn(async (): Promise<boolean | null> => false));
vi.mock('@/lib/auth/magic-link/buyer-email-policy', () => ({ readBuyerEmailPolicy: buyerPolicy }));
const eventMailForSlug = vi.hoisted(() => vi.fn(async () => ({} as Record<string,string>)));
vi.mock('@/lib/events/mail', () => ({ eventMailForSlug }));
const deliverMagicLink = vi.hoisted(() => vi.fn());
const verifyCaptchaToken = vi.hoisted(() => vi.fn());
const validateEmailAction = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const checkRateLimitForIdentifier = vi.hoisted(() => vi.fn());
const prepareFreeGrantRequest = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink }));
vi.mock('@/lib/services/free-grant-context', () => ({ prepareFreeGrantRequest }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
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
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', 'false');
    deliverMagicLink.mockReset();
    verifyCaptchaToken.mockReset();
    validateEmailAction.mockReset();
    checkRateLimit.mockReset();
    checkRateLimitForIdentifier.mockReset();
    prepareFreeGrantRequest.mockReset();
    prepareFreeGrantRequest.mockResolvedValue({ ok: true, requestId: '00000000-0000-4000-8000-000000000001', values: {} });

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

  it('returns a newly created partner account to the localized application', async () => {
    const result = await requestMagicLink({ ...BASE_INPUT, redirectTo: '/pl/affiliates/apply' });
    expect(result).toEqual({ ok: true });
    expect(deliverMagicLink).toHaveBeenCalledWith(expect.objectContaining({
      shouldCreateUser: true,
      redirectTo: 'https://shop.example.com/auth/callback?redirect_to=%2Fpl%2Faffiliates%2Fapply',
    }));
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
            '/auth/product-access?product=widget&coupon=SAVE10&success_url=https%3A%2F%2Fseller.example.com%2Fthanks&free_grant=00000000-0000-4000-8000-000000000001',
          ),
        data: { product_slug: 'widget', locale: 'en' },
      }),
    );
  });

  it('passes purchased event details into the access mail after captcha verification', async () => {
    eventMailForSlug.mockResolvedValueOnce({ event_date: '10 Jan 2036', event_online_url: 'https://meet.example.com/private' });
    await requestMagicLink({ ...BASE_INPUT, flow: 'post_checkout', productSlug: 'event' });
    expect(eventMailForSlug).toHaveBeenCalledWith(BASE_INPUT.email, 'event', undefined);
    expect(deliverMagicLink).toHaveBeenCalledWith(expect.objectContaining({ data: { event_date: '10 Jan 2036', event_online_url: 'https://meet.example.com/private', locale: 'en' } }));
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

  it.each(['en', 'pl'])('preserves %s guest checkout locale through delivery', async locale => {
    expect(await requestMagicLink({ ...BASE_INPUT, flow: 'post_checkout', productSlug: 'course', locale })).toEqual({ ok: true });
    const destination = new URL(deliverMagicLink.mock.calls[0][0].redirectTo);
    expect(destination.searchParams.get('redirect_to')).toBe(`/${locale}/auth/product-access?product=course`);
  });

  it.each(['//elsewhere.test', '/pl/affiliates/apply\n', '/pl/%61ffiliates/apply', '/auth/product-access?product=course&return_url=https://elsewhere.test'])('declines unsupported explicit destination %j before delivery', async redirectTo => {
    expect(await requestMagicLink({ ...BASE_INPUT, redirectTo })).toEqual({ ok: false, code: 'invalid_request' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('rejects free_product without a productSlug', async () => {
    const result = await requestMagicLink({ ...BASE_INPUT, flow: 'free_product' });

    expect(result).toEqual({ ok: false, code: 'invalid_request' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });

  it('stores the requested free product before email so any later sign-in can finish it', async () => {
    await requestMagicLink({ ...BASE_INPUT, flow: 'free_product', productSlug: 'widget' });

    expect(prepareFreeGrantRequest).toHaveBeenCalledWith(expect.anything(), 'buyer@example.com', 'widget', undefined);
  });

  it('retains the prepared checkout context when email delivery fails', async () => {
    deliverMagicLink.mockResolvedValueOnce({ ok: false, code: 'send_failed' });

    await requestMagicLink({ ...BASE_INPUT, flow: 'free_product', productSlug: 'widget' });

    expect(prepareFreeGrantRequest).toHaveBeenCalledTimes(1);
  });

  it('never queues a grant for login or post_checkout links', async () => {
    await requestMagicLink({ ...BASE_INPUT, flow: 'login' });
    await requestMagicLink({ ...BASE_INPUT, flow: 'post_checkout', productSlug: 'widget' });

    expect(prepareFreeGrantRequest).not.toHaveBeenCalled();
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


describe('trusted magic link callback gate', () => {
  it.each([
    'https://evil.example/auth/callback?flow=login',
    'https://shop.example.com/auth/callback',
    'https://shop.example.com/other?flow=login',
    '/auth/callback?flow=login',
    'https://shop.example.com/auth/callback?redirect_to=%2F%2Felsewhere.test',
    'https://shop.example.com/auth/callback?redirect_to=%252Fpl%252Faffiliates%252Fapply',
    'https://shop.example.com/auth/callback?redirect_to=%2Fdashboard',
  ])('rejects malformed or foreign redirect %s before delivery', async redirectTo => {
    deliverMagicLink.mockClear();
    expect(await sendTrustedMagicLink({ email: 'buyer@example.com', redirectTo })).toEqual({ ok: false, code: 'invalid_request' });
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });
});

describe('demo magic links', () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DEMO_MODE', 'true');
  });

  it.each(['login', 'free_product', 'post_checkout'] as const)('declines %s before processing', async (flow) => {
    expect(await requestMagicLink({ ...BASE_INPUT, flow, productSlug: 'widget' }))
      .toEqual({ ok: false, code: 'demo_mode' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(verifyCaptchaToken).not.toHaveBeenCalled();
    expect(validateEmailAction).not.toHaveBeenCalled();
    expect(deliverMagicLink).not.toHaveBeenCalled();
    expect(prepareFreeGrantRequest).not.toHaveBeenCalled();
  });

  it('declines trusted delivery before processing', async () => {
    expect(await sendTrustedMagicLink({ email: BASE_INPUT.email, redirectTo: buildLoginMagicLinkRedirect('https://shop.example.com') }))
      .toEqual({ ok: false, code: 'demo_mode' });
    expect(checkRateLimitForIdentifier).not.toHaveBeenCalled();
    expect(deliverMagicLink).not.toHaveBeenCalled();
  });
});

it.each(['pl', 'en'])('passes %s to login email data', async locale => {
  vi.stubEnv('DEMO_MODE', 'false');
  checkRateLimit.mockResolvedValue(true); checkRateLimitForIdentifier.mockResolvedValue(true);
  verifyCaptchaToken.mockResolvedValue({ success: true }); validateEmailAction.mockResolvedValue({ isValid: true });
  deliverMagicLink.mockResolvedValue({ ok: true });
  await requestMagicLink({ ...BASE_INPUT, locale });
  expect(deliverMagicLink).toHaveBeenLastCalledWith(expect.objectContaining({ data: { locale } }));
});

it('skips disabled buyer notifications before consuming the authentication mail allowance', async () => {
  vi.stubEnv('DEMO_MODE', 'false');
  checkRateLimitForIdentifier.mockClear(); deliverMagicLink.mockClear();
  expect(await sendTrustedMagicLink({ email: 'buyer@example.com', redirectTo: buildLoginMagicLinkRedirect('https://shop.example.com'), transactionalOnly: true, data: { license_key: 'signed.key' } })).toEqual({ ok: true, skipped: true });
  expect(checkRateLimitForIdentifier).not.toHaveBeenCalled();
  expect(deliverMagicLink).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

it('queues a license notification when the buyer email policy is temporarily unavailable', async () => {
  vi.stubEnv('DEMO_MODE', 'false');
  buyerPolicy.mockResolvedValueOnce(null);
  expect(await sendTrustedMagicLink({ email: 'buyer@example.com', redirectTo: buildLoginMagicLinkRedirect('https://shop.example.com'), transactionalOnly: true, retry: 'license', data: { license_key: 'signed.key' } })).toEqual({ ok: false, code: 'send_failed', queued: true });
  expect(policyRetry).toHaveBeenCalledWith(expect.objectContaining({ kind: 'license', code: 'send_failed' }));
  vi.unstubAllEnvs();
});
