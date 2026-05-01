/**
 * Magic-link `emailRedirectTo` builders. Both post-checkout and free-product
 * flows route through /auth/product-access?product=<slug>; payment
 * identifiers are not part of the URL.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPostCheckoutMagicLinkRedirect,
  buildFreeProductMagicLinkRedirect,
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
});
