import { describe, it, expect } from 'vitest';
import {
  buildOtoRedirectUrl,
  validateOtoRedirectUrl,
  buildSuccessRedirectUrl,
  hasHideBumpParam
} from '@/lib/payment/oto-redirect';

describe('OTO Redirect URL Builder', () => {
  describe('buildOtoRedirectUrl', () => {
    it('should build complete URL with all params', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'premium-course',
        customerEmail: 'john@example.com',
        couponCode: 'OTO-ABC123',
        baseUrl: 'https://example.com'
      });

      expect(result.url).toBe('https://example.com/pl/checkout/premium-course?email=john%40example.com&coupon=OTO-ABC123&oto=1');
      expect(result.hasAllRequiredParams).toBe(true);
      expect(result.missingParams).toEqual([]);
    });

    it('should report missing email param', () => {
      const result = buildOtoRedirectUrl({
        locale: 'en',
        otoProductSlug: 'course',
        customerEmail: undefined, // Missing!
        couponCode: 'OTO-XYZ'
      });

      expect(result.hasAllRequiredParams).toBe(false);
      expect(result.missingParams).toContain('email');
      expect(result.url).not.toContain('email=');
      expect(result.url).toContain('coupon=OTO-XYZ');
      expect(result.url).toContain('oto=1');
    });

    it('should report missing coupon param', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'product',
        customerEmail: 'test@test.com',
        couponCode: undefined // Missing!
      });

      expect(result.hasAllRequiredParams).toBe(false);
      expect(result.missingParams).toContain('coupon');
      expect(result.url).toContain('email=test%40test.com');
      expect(result.url).not.toContain('coupon=');
    });

    it('should report both missing params', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'product',
        customerEmail: undefined,
        couponCode: undefined
      });

      expect(result.hasAllRequiredParams).toBe(false);
      expect(result.missingParams).toContain('email');
      expect(result.missingParams).toContain('coupon');
    });

    it('should always include oto=1 param', () => {
      const result = buildOtoRedirectUrl({
        locale: 'en',
        otoProductSlug: 'test',
        customerEmail: 'a@b.com',
        couponCode: 'CODE'
      });

      expect(result.url).toContain('oto=1');
    });

    it('should use default baseUrl when not provided', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: 'a@b.com',
        couponCode: 'CODE'
      });

      expect(result.url.startsWith('http://localhost:3000/')).toBe(true);
    });

    it('should handle empty string email as missing', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: '',
        couponCode: 'CODE'
      });

      expect(result.hasAllRequiredParams).toBe(false);
      expect(result.missingParams).toContain('email');
    });

    it('should encode special characters in email', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: 'user+tag@example.com',
        couponCode: 'CODE'
      });

      expect(result.url).toContain('email=user%2Btag%40example.com');
    });

    it('should add hide_bump param when hideBump is true', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: 'test@test.com',
        couponCode: 'CODE',
        hideBump: true
      });

      expect(result.url).toContain('hide_bump=true');
    });

    it('should not add hide_bump param when hideBump is false', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: 'test@test.com',
        couponCode: 'CODE',
        hideBump: false
      });

      expect(result.url).not.toContain('hide_bump');
    });

    it('should add productId and sessionId when passParams is true', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: 'test@test.com',
        couponCode: 'CODE',
        passParams: true,
        sourceProductId: 'prod-123',
        sessionId: 'sess-456'
      });

      expect(result.url).toContain('productId=prod-123');
      expect(result.url).toContain('sessionId=sess-456');
    });

    it('should not add productId and sessionId when passParams is false', () => {
      const result = buildOtoRedirectUrl({
        locale: 'pl',
        otoProductSlug: 'test',
        customerEmail: 'test@test.com',
        couponCode: 'CODE',
        passParams: false,
        sourceProductId: 'prod-123',
        sessionId: 'sess-456'
      });

      expect(result.url).not.toContain('productId');
      expect(result.url).not.toContain('sessionId');
    });

    it('should combine all optional params correctly', () => {
      const result = buildOtoRedirectUrl({
        locale: 'en',
        otoProductSlug: 'premium',
        customerEmail: 'buyer@shop.com',
        couponCode: 'OTO-DISCOUNT',
        baseUrl: 'https://myshop.com',
        hideBump: true,
        passParams: true,
        sourceProductId: 'src-product-id',
        sessionId: 'stripe-session-id'
      });

      expect(result.url).toBe(
        'https://myshop.com/en/checkout/premium?email=buyer%40shop.com&coupon=OTO-DISCOUNT&oto=1&hide_bump=true&productId=src-product-id&sessionId=stripe-session-id'
      );
      expect(result.hasAllRequiredParams).toBe(true);
    });
  });

  describe('validateOtoRedirectUrl', () => {
    it('should validate complete URL as valid', () => {
      const result = validateOtoRedirectUrl(
        'https://example.com/pl/checkout/product?email=test@test.com&coupon=OTO-123&oto=1'
      );

      expect(result.valid).toBe(true);
      expect(result.missingParams).toEqual([]);
    });

    it('should detect missing email', () => {
      const result = validateOtoRedirectUrl(
        'https://example.com/checkout/product?coupon=OTO-123&oto=1'
      );

      expect(result.valid).toBe(false);
      expect(result.missingParams).toContain('email');
    });

    it('should detect missing coupon', () => {
      const result = validateOtoRedirectUrl(
        'https://example.com/checkout/product?email=test@test.com&oto=1'
      );

      expect(result.valid).toBe(false);
      expect(result.missingParams).toContain('coupon');
    });

    it('should detect missing oto param', () => {
      const result = validateOtoRedirectUrl(
        'https://example.com/checkout/product?email=test@test.com&coupon=OTO-123'
      );

      expect(result.valid).toBe(false);
      expect(result.missingParams).toContain('oto');
    });

    it('should detect wrong oto value', () => {
      const result = validateOtoRedirectUrl(
        'https://example.com/checkout/product?email=test@test.com&coupon=OTO-123&oto=0'
      );

      expect(result.valid).toBe(false);
      expect(result.missingParams).toContain('oto');
    });

    it('should handle invalid URL', () => {
      const result = validateOtoRedirectUrl('not-a-valid-url');

      expect(result.valid).toBe(false);
      expect(result.missingParams).toContain('invalid_url');
    });

    it('should detect all missing params', () => {
      const result = validateOtoRedirectUrl(
        'https://example.com/checkout/product'
      );

      expect(result.valid).toBe(false);
      expect(result.missingParams).toContain('email');
      expect(result.missingParams).toContain('coupon');
      expect(result.missingParams).toContain('oto');
    });
  });
});

describe('Success Redirect URL Builder', () => {
  describe('buildSuccessRedirectUrl', () => {
    it('should return URL as-is when passParams is false', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://example.com/thank-you',
        passParams: false
      });

      expect(result.url).toBe('https://example.com/thank-you');
      expect(result.hasHideBump).toBe(false);
    });

    it('should detect hide_bump in URL when passParams is false', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://example.com/thank-you?hide_bump=true',
        passParams: false
      });

      expect(result.url).toBe('https://example.com/thank-you?hide_bump=true');
      expect(result.hasHideBump).toBe(true);
    });

    it('should add customer params when passParams is true', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://example.com/thank-you',
        passParams: true,
        customerEmail: 'test@example.com',
        productId: 'prod-123',
        sessionId: 'sess-456'
      });

      expect(result.url).toContain('email=test%40example.com');
      expect(result.url).toContain('productId=prod-123');
      expect(result.url).toContain('sessionId=sess-456');
    });

    it('should handle relative URLs', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: '/thank-you',
        baseUrl: 'https://myshop.com',
        passParams: true,
        customerEmail: 'buyer@test.com'
      });

      expect(result.url).toBe('https://myshop.com/thank-you?email=buyer%40test.com');
    });

    it('should handle domain-only URLs by adding https', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'example.com/success',
        passParams: true,
        productId: 'p123'
      });

      expect(result.url).toBe('https://example.com/success?productId=p123');
    });

    it('should preserve existing query params including hide_bump', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://example.com/success?hide_bump=true&ref=partner',
        passParams: true,
        customerEmail: 'user@test.com'
      });

      expect(result.url).toContain('hide_bump=true');
      expect(result.url).toContain('ref=partner');
      expect(result.url).toContain('email=user%40test.com');
      expect(result.hasHideBump).toBe(true);
    });

    it('should filter out internal params from additionalParams', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://example.com/success',
        passParams: true,
        additionalParams: {
          session_id: 'should-be-filtered',
          success_url: 'should-be-filtered',
          payment_intent: 'should-be-filtered',
          custom_param: 'should-be-kept',
          another: 'also-kept'
        }
      });

      expect(result.url).not.toContain('session_id');
      expect(result.url).not.toContain('success_url');
      expect(result.url).not.toContain('payment_intent');
      expect(result.url).toContain('custom_param=should-be-kept');
      expect(result.url).toContain('another=also-kept');
    });

    it('should use default baseUrl when not provided', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: '/success',
        passParams: true
      });

      expect(result.url.startsWith('http://localhost:3000/')).toBe(true);
    });

    it('should handle URL with existing params and add new ones', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://shop.com/thankyou?existing=value',
        passParams: true,
        customerEmail: 'john@doe.com',
        productId: 'xyz'
      });

      expect(result.url).toContain('existing=value');
      expect(result.url).toContain('email=john%40doe.com');
      expect(result.url).toContain('productId=xyz');
    });

    it('should skip undefined values in additionalParams', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://example.com/success',
        passParams: true,
        additionalParams: {
          defined: 'value',
          undefined_param: undefined
        }
      });

      expect(result.url).toContain('defined=value');
      expect(result.url).not.toContain('undefined_param');
    });

    it('should combine all params correctly', () => {
      const result = buildSuccessRedirectUrl({
        targetUrl: 'https://shop.com/success?hide_bump=true',
        baseUrl: 'https://shop.com',
        passParams: true,
        customerEmail: 'customer@shop.com',
        productId: 'product-uuid',
        sessionId: 'stripe-session',
        additionalParams: {
          utm_source: 'email',
          session_id: 'filtered-out'
        }
      });

      expect(result.url).toBe(
        'https://shop.com/success?hide_bump=true&email=customer%40shop.com&productId=product-uuid&sessionId=stripe-session&utm_source=email'
      );
      expect(result.hasHideBump).toBe(true);
    });
  });

  describe('hasHideBumpParam', () => {
    it('should return true when hide_bump=true is in URL', () => {
      expect(hasHideBumpParam('https://example.com?hide_bump=true')).toBe(true);
      expect(hasHideBumpParam('/path?foo=bar&hide_bump=true&baz=qux')).toBe(true);
    });

    it('should return false when hide_bump is not in URL', () => {
      expect(hasHideBumpParam('https://example.com/path')).toBe(false);
      expect(hasHideBumpParam('/path?foo=bar')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(hasHideBumpParam(null)).toBe(false);
      expect(hasHideBumpParam(undefined)).toBe(false);
    });

    it('should return false for hide_bump with different value', () => {
      expect(hasHideBumpParam('https://example.com?hide_bump=false')).toBe(false);
      expect(hasHideBumpParam('https://example.com?hide_bump=1')).toBe(false);
    });
  });
});
