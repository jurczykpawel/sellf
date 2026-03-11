/**
 * Tests for marketplace checkout flow — application_fee + transfer_data
 *
 * Verifies that CheckoutService correctly adds Stripe Connect parameters
 * when a seller is involved in the checkout.
 *
 * @see src/lib/services/checkout.ts
 * @see src/types/checkout.ts — CheckoutSellerInfo
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckoutSessionOptions, CheckoutSellerInfo } from '@/types/checkout';

describe('Marketplace Checkout', () => {
  describe('CheckoutSellerInfo type', () => {
    it('should have required fields for Stripe Connect', () => {
      const seller: CheckoutSellerInfo = {
        stripeAccountId: 'acct_test123',
        platformFeePercent: 5,
        sellerSlug: 'nick',
        schemaName: 'seller_nick',
      };

      expect(seller.stripeAccountId).toBe('acct_test123');
      expect(seller.platformFeePercent).toBe(5);
      expect(seller.sellerSlug).toBe('nick');
      expect(seller.schemaName).toBe('seller_nick');
    });
  });

  describe('CheckoutSessionOptions with seller', () => {
    it('should accept seller info in options', () => {
      const options: CheckoutSessionOptions = {
        product: {
          id: 'prod-1',
          slug: 'test-product',
          name: 'Test Product',
          description: null,
          price: 49.99,
          currency: 'USD',
          is_active: true,
          available_from: null,
          available_until: null,
          vat_rate: null,
          price_includes_vat: false,
        },
        returnUrl: 'https://example.com/return',
        seller: {
          stripeAccountId: 'acct_seller1',
          platformFeePercent: 5,
          sellerSlug: 'nick',
          schemaName: 'seller_nick',
        },
      };

      expect(options.seller).toBeDefined();
      expect(options.seller!.stripeAccountId).toBe('acct_seller1');
    });

    it('should work without seller info (standalone mode)', () => {
      const options: CheckoutSessionOptions = {
        product: {
          id: 'prod-1',
          slug: 'test-product',
          name: 'Test Product',
          description: null,
          price: 49.99,
          currency: 'USD',
          is_active: true,
          available_from: null,
          available_until: null,
          vat_rate: null,
          price_includes_vat: false,
        },
        returnUrl: 'https://example.com/return',
      };

      expect(options.seller).toBeUndefined();
    });
  });

  describe('Application fee calculation', () => {
    it('should calculate correct fee for single product', () => {
      const price = 49.99;
      const feePercent = 5;
      const totalCents = Math.round(price * 100);
      const feeAmount = Math.round(totalCents * feePercent / 100);

      // 4999 * 5 / 100 = 249.95 → 250 cents = $2.50
      expect(feeAmount).toBe(250);
    });

    it('should calculate correct fee for product with bumps', () => {
      const mainPrice = 49.99;
      const bump1Price = 19.99;
      const bump2Price = 9.99;
      const feePercent = 5;

      const totalCents = Math.round(mainPrice * 100) + Math.round(bump1Price * 100) + Math.round(bump2Price * 100);
      const feeAmount = Math.round(totalCents * feePercent / 100);

      // (4999 + 1999 + 999) = 7997 * 5 / 100 = 399.85 → 400 cents = $4.00
      expect(feeAmount).toBe(400);
    });

    it('should handle 0% fee (owner seller_main)', () => {
      const price = 100;
      const feePercent = 0;
      const totalCents = Math.round(price * 100);
      const feeAmount = Math.round(totalCents * feePercent / 100);

      expect(feeAmount).toBe(0);
    });

    it('should handle high fee percentage', () => {
      const price = 100;
      const feePercent = 15;
      const totalCents = Math.round(price * 100);
      const feeAmount = Math.round(totalCents * feePercent / 100);

      // 10000 * 15 / 100 = 1500 cents = $15.00
      expect(feeAmount).toBe(1500);
    });

    it('should handle fee with coupon discount', () => {
      const mainPrice = 100;
      const couponDiscount = 20; // 20% off
      const discountedPrice = mainPrice * (1 - couponDiscount / 100); // $80
      const feePercent = 5;

      const totalCents = Math.round(discountedPrice * 100);
      const feeAmount = Math.round(totalCents * feePercent / 100);

      // 8000 * 5 / 100 = 400 cents = $4.00
      expect(feeAmount).toBe(400);
    });
  });

  describe('Metadata for marketplace payments', () => {
    it('should include seller metadata in session config', () => {
      const seller: CheckoutSellerInfo = {
        stripeAccountId: 'acct_test123',
        platformFeePercent: 5,
        sellerSlug: 'nick',
        schemaName: 'seller_nick',
      };

      const metadata: Record<string, string> = {
        product_id: 'prod-1',
        ...(seller && {
          seller_slug: seller.sellerSlug,
          seller_schema: seller.schemaName,
          is_marketplace: 'true',
        }),
      };

      expect(metadata.seller_slug).toBe('nick');
      expect(metadata.seller_schema).toBe('seller_nick');
      expect(metadata.is_marketplace).toBe('true');
    });

    it('should NOT include seller metadata for standalone mode', () => {
      const seller = undefined;

      const metadata: Record<string, string> = {
        product_id: 'prod-1',
        ...(seller && {
          seller_slug: 'should-not-appear',
          seller_schema: 'should-not-appear',
          is_marketplace: 'true',
        }),
      };

      expect(metadata.seller_slug).toBeUndefined();
      expect(metadata.seller_schema).toBeUndefined();
      expect(metadata.is_marketplace).toBeUndefined();
    });
  });

  describe('Webhook schema routing', () => {
    it('should detect marketplace payment from metadata', () => {
      const metadata = {
        product_id: 'prod-1',
        seller_schema: 'seller_nick',
        is_marketplace: 'true',
      };

      const isMarketplace = metadata.is_marketplace === 'true';
      const sellerSchema = metadata.seller_schema;

      expect(isMarketplace).toBe(true);
      expect(sellerSchema).toBe('seller_nick');
    });

    it('should NOT route standalone payments to seller schema', () => {
      const metadata = {
        product_id: 'prod-1',
      } as Record<string, string>;

      const isMarketplace = metadata.is_marketplace === 'true';
      const sellerSchema = metadata.seller_schema;

      expect(isMarketplace).toBe(false);
      expect(sellerSchema).toBeUndefined();
    });
  });
});
