/**
 * Magic-link `emailRedirectTo` builders. Both post-checkout and free-product
 * flows route through /auth/product-access?product=<slug>; payment
 * identifiers are not part of the URL.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPostCheckoutMagicLinkRedirect,
  buildFreeProductMagicLinkRedirect,
  buildLoginMagicLinkRedirect,
  getLoginReturnPath,
} from '@/lib/auth/magic-link-redirect';

describe('Magic-link redirect URL construction', () => {
  describe('buildPostCheckoutMagicLinkRedirect', () => {
    it('does NOT embed Stripe session_id in the callback URL', () => {
      const url = buildPostCheckoutMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'my-product',
        sessionId: 'cs_test_a1b2c3d4',
        paymentIntentId: undefined,
      });
      expect(url).not.toContain('cs_test_a1b2c3d4');
      expect(url).not.toContain('session_id');
    });

    it('does NOT embed payment_intent in the callback URL', () => {
      const url = buildPostCheckoutMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'my-product',
        sessionId: undefined,
        paymentIntentId: 'pi_test_xyz789',
      });
      expect(url).not.toContain('pi_test_xyz789');
      expect(url).not.toContain('payment_intent');
    });

    it('routes to /auth/product-access for post-login UX', () => {
      const url = buildPostCheckoutMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'my-product',
        sessionId: 'cs_test_abc',
        paymentIntentId: undefined,
      });
      expect(url).toMatch(/\/auth\/callback\?redirect_to=/);
      const decoded = decodeURIComponent(url.split('redirect_to=')[1]);
      expect(decoded).toBe('/auth/product-access?product=my-product');
    });

    it('properly URL-encodes a slug with special characters', () => {
      const url = buildPostCheckoutMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'kurs nr 1',
        sessionId: 'cs_test',
        paymentIntentId: undefined,
      });
      const decoded = decodeURIComponent(url.split('redirect_to=')[1]);
      expect(decoded).toBe('/auth/product-access?product=kurs%20nr%201');
    });
  });

  describe('buildFreeProductMagicLinkRedirect', () => {
    it('uses /auth/product-access without payment identifiers', () => {
      const url = buildFreeProductMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'free-thing',
      });
      const decoded = decodeURIComponent(url.split('redirect_to=')[1]);
      expect(decoded).toBe('/auth/product-access?product=free-thing');
    });

    it('passes through coupon code when provided', () => {
      const url = buildFreeProductMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'free-thing',
        couponCode: 'WELCOME100',
      });
      const decoded = decodeURIComponent(url.split('redirect_to=')[1]);
      expect(decoded).toContain('coupon=WELCOME100');
    });

    it('passes through success_url when provided', () => {
      const url = buildFreeProductMagicLinkRedirect({
        origin: 'https://shop.example.com',
        productSlug: 'free-thing',
        successUrl: 'https://shop.example.com/thank-you',
      });
      const decoded = decodeURIComponent(url.split('redirect_to=')[1]);
      expect(decoded).toContain('success_url=https%3A%2F%2Fshop.example.com%2Fthank-you');
    });
  });

  describe('buildLoginMagicLinkRedirect', () => {
    it.each(['/affiliates/apply', '/pl/affiliates/apply', '/en/affiliates/apply'])('retains the application destination %s', path => {
      expect(new URL(buildLoginMagicLinkRedirect('https://a.b', path)).searchParams.get('redirect_to')).toBe(path);
    });
    it.each(['//elsewhere.test', '/\\elsewhere.test', 'https://elsewhere.test', '/dashboard', '/pl/affiliates/apply?next=elsewhere'])('uses default login routing for %s', path => {
      expect(buildLoginMagicLinkRedirect('https://a.b', path)).toBe('https://a.b/auth/callback?flow=login');
    });
    it('routes through /auth/callback without redirect_to, so the callback applies role-based routing', () => {
      const url = buildLoginMagicLinkRedirect('https://a.b');
      expect(url).toContain('?');
      expect(url).not.toContain('redirect_to');
      expect(url).toBe('https://a.b/auth/callback?flow=login');
    });
  });
});

it('retains the buyer locale in a post-checkout email destination', () => {
  const url = new URL(buildPostCheckoutMagicLinkRedirect({ origin: 'https://shop.example', productSlug: 'course', sessionId: undefined, paymentIntentId: undefined, locale: 'pl' }));
  expect(url.searchParams.get('redirect_to')).toBe('/pl/auth/product-access?product=course');
});


describe('supported account return paths', () => {
  it.each(['', '/pl', '/en'])('shares localized application and product destinations with prefix %s', prefix => {
    for (const path of [`${prefix}/affiliates/apply`, `${prefix}/auth/product-access?product=course`]) {
      expect(getLoginReturnPath(path)).toBe(path);
      expect(new URL(buildLoginMagicLinkRedirect('https://shop.example', path)).searchParams.get('redirect_to')).toBe(path);
    }
  });
  it.each([
    'https://elsewhere.test/affiliates/apply', '//elsewhere.test/affiliates/apply',
    '/\\elsewhere.test/affiliates/apply', '/%2f%2felsewhere.test/affiliates/apply',
    '%2Fpl%2Faffiliates%2Fapply', '/pl/%61ffiliates/apply', '/pl/affiliates/%2561pply',
    '/pl/../affiliates/apply', '/pl/affiliates/apply#x', '/pl/affiliates/apply?next=/dashboard',
    '/pl/affiliates/apply\n', '/pl/affiliates/apply\r', '/pl/affiliates/apply\t',
    '/de/affiliates/apply', '/pl/auth/product-access?product=course&return_url=https://elsewhere.test',
    '/auth/product-access?product=course&product=other', '/auth/product-access?product=%252f%252felsewhere.test',
    '/auth/product-access?%70roduct=course', '/auth/product-access?product=course#x',
  ])('declines unsupported return value %j', path => {
    expect(getLoginReturnPath(path)).toBeUndefined();
    expect(buildLoginMagicLinkRedirect('https://shop.example', path)).toBe('https://shop.example/auth/callback?flow=login');
  });
});


describe('loginwall return paths', () => {
  const id = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
  const redirect = encodeURIComponent('https://customer.example/course?a=1&b=2');
  const query = `id=${id}&redirect=${redirect}`;

  it.each(['', '/en', '/pl'])('retains a canonical protect destination with prefix %s', prefix => {
    const path = `${prefix}/loginwall/protect?${query}`;
    expect(getLoginReturnPath(path)).toBe(path);
    expect(new URL(buildLoginMagicLinkRedirect('https://shop.example', path)).searchParams.get('redirect_to')).toBe(path);
  });

  it('retains either canonical parameter order and the redirect length boundary', () => {
    const path = `/loginwall/protect?redirect=${'a'.repeat(2048)}&id=${id}`;
    expect(getLoginReturnPath(path)).toBe(path);
  });

  it.each([
    `redirect=${redirect}`, `id=invalid&redirect=${redirect}`, `id=${id}`,
    `${query}&other=value`, `${query}&redirect=${redirect}`, `${query}&id=${id}`,
    `id=${id}&redirect=`, `id=${id}&redirect=${'a'.repeat(2049)}`,
    `id=${id}&redirect=${encodeURIComponent('https://customer.example/\n')}`,
    `id=${id}&redirect=${encodeURIComponent('https://customer.example/\u007f')}`,
    `${query}#section`, `id=${id}&redirect=https%3a%2f%2fcustomer.example`,
    `id=${id}&redirect=customer+page`, `id=${id}&%72edirect=${redirect}`,
  ])('declines unsupported protect query %j', invalid => {
    expect(getLoginReturnPath(`/loginwall/protect?${invalid}`)).toBeUndefined();
  });

  it.each(['/de/loginwall/protect', '/loginwall/protect/'])('declines unsupported protect path %s', path => {
    expect(getLoginReturnPath(`${path}?${query}`)).toBeUndefined();
  });
});
