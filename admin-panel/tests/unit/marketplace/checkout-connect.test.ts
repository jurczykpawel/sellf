/**
 * Tests for Stripe Connect checkout wiring — destination charges
 *
 * Verifies that the checkout flow correctly handles marketplace seller payments:
 * - Seller lookup and validation before Stripe session creation
 * - Destination charges with application_fee_amount + transfer_data
 * - Marketplace metadata in session config
 * - Webhook registration with Connect support
 * - Webhook handler routing by seller_schema
 *
 * Uses static source analysis for checkout service (like existing marketplace tests)
 * and direct imports for webhook registration + constants.
 *
 * @see src/lib/services/checkout.ts — createCheckoutSession + createStripeSession
 * @see src/types/checkout.ts — CheckoutSellerInfo, CheckoutSessionOptions
 * @see src/lib/stripe/webhook-registration.ts — buildWebhookParams
 * @see src/lib/constants.ts — STRIPE_WEBHOOK_EVENTS
 * @see src/app/api/webhooks/stripe/route.ts — webhook handler
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckoutSellerInfo, CheckoutSessionOptions, CreateCheckoutRequest } from '@/types/checkout';
import { buildWebhookParams } from '@/lib/stripe/webhook-registration';
import { STRIPE_WEBHOOK_EVENTS } from '@/lib/constants';

// ===== HELPERS =====

const SRC_ROOT = path.resolve(__dirname, '../../../src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf-8');
}

// ===== TESTS =====

// =====================================================
// 1. Checkout service — seller Connect wiring
// =====================================================

describe('Checkout service — seller Connect wiring', () => {
  const checkoutSource = readSource('lib/services/checkout.ts');

  it('createCheckoutSession resolves seller from sellerSlug before creating Stripe session', () => {
    // The seller lookup block must appear before createStripeSession call
    const sellerLookupIndex = checkoutSource.indexOf("request.sellerSlug");
    const createSessionIndex = checkoutSource.indexOf("this.createStripeSession(");

    expect(sellerLookupIndex).toBeGreaterThan(-1);
    expect(createSessionIndex).toBeGreaterThan(-1);
    expect(sellerLookupIndex).toBeLessThan(createSessionIndex);
  });

  it('seller lookup uses createPlatformClient (public schema)', () => {
    expect(checkoutSource).toContain('createPlatformClient()');
    // The platform client is used for seller query
    const platformIndex = checkoutSource.indexOf('createPlatformClient()');
    const sellerQueryIndex = checkoutSource.indexOf(".from('sellers')");
    expect(platformIndex).toBeGreaterThan(-1);
    expect(sellerQueryIndex).toBeGreaterThan(-1);
    expect(sellerQueryIndex).toBeGreaterThan(platformIndex);
  });

  it('seller lookup checks stripe_account_id AND stripe_onboarding_complete', () => {
    // The select query must include both fields
    expect(checkoutSource).toContain('stripe_account_id');
    expect(checkoutSource).toContain('stripe_onboarding_complete');

    // The validation checks both conditions
    expect(checkoutSource).toContain('!seller?.stripe_account_id');
    expect(checkoutSource).toContain('!seller.stripe_onboarding_complete');
  });

  it('throws CheckoutError when seller has no stripe_account_id', () => {
    // The error condition covers missing stripe_account_id
    expect(checkoutSource).toContain('!seller?.stripe_account_id');
    expect(checkoutSource).toContain("'Seller has not completed Stripe setup'");
  });

  it('throws CheckoutError when seller onboarding is incomplete', () => {
    // Same conditional block handles both missing account and incomplete onboarding
    const errorBlock = checkoutSource.includes(
      '!seller?.stripe_account_id || !seller.stripe_onboarding_complete'
    );
    expect(errorBlock).toBe(true);
    expect(checkoutSource).toContain('CheckoutErrorType.VALIDATION_ERROR');
  });

  it('passes CheckoutSellerInfo to createStripeSession options', () => {
    // The seller info is built and passed as seller: sellerInfo
    expect(checkoutSource).toContain('seller: sellerInfo');
    // sellerInfo is constructed from DB fields
    expect(checkoutSource).toContain('stripeAccountId: seller.stripe_account_id');
    expect(checkoutSource).toContain('platformFeePercent: seller.platform_fee_percent');
    expect(checkoutSource).toContain('sellerSlug: seller.slug');
    expect(checkoutSource).toContain('schemaName: seller.schema_name');
  });
});

// =====================================================
// 2. Stripe session — destination charges
// =====================================================

describe('Stripe session — destination charges', () => {
  const checkoutSource = readSource('lib/services/checkout.ts');

  it('session metadata includes seller_slug, seller_schema, is_marketplace when seller provided', () => {
    // Marketplace metadata is spread when options.seller exists
    expect(checkoutSource).toContain("seller_slug: options.seller.sellerSlug");
    expect(checkoutSource).toContain("seller_schema: options.seller.schemaName");
    expect(checkoutSource).toContain("is_marketplace: 'true'");
  });

  it('payment_intent_data includes application_fee_amount when seller provided', () => {
    expect(checkoutSource).toContain('application_fee_amount: feeAmount');
    // feeAmount is calculated before being assigned
    expect(checkoutSource).toContain('const feeAmount = Math.round(totalCents * options.seller.platformFeePercent / 100)');
  });

  it('payment_intent_data includes transfer_data.destination with seller stripeAccountId', () => {
    expect(checkoutSource).toContain('transfer_data: {');
    expect(checkoutSource).toContain('destination: options.seller.stripeAccountId');
  });

  it('application_fee is calculated from totalCents * platformFeePercent / 100', () => {
    // Verify the exact formula: Math.round(totalCents * platformFeePercent / 100)
    const feeCalcPattern = 'Math.round(totalCents * options.seller.platformFeePercent / 100)';
    expect(checkoutSource).toContain(feeCalcPattern);
  });

  it('no marketplace metadata or fee when no seller (platform checkout)', () => {
    // The seller metadata and payment_intent_data are conditionally spread
    // Metadata: ...(options.seller && { ... })
    expect(checkoutSource).toContain('...(options.seller && {');
    // Fee: if (options.seller) { ... payment_intent_data ... }
    expect(checkoutSource).toContain('if (options.seller)');
  });
});

// =====================================================
// 3. Webhook registration — Connect support
// =====================================================

describe('Webhook registration — Connect support', () => {
  it('buildWebhookParams includes connect: true', () => {
    const params = buildWebhookParams('https://example.com/api/webhooks/stripe');

    expect(params).toHaveProperty('connect', true);
  });

  it('STRIPE_WEBHOOK_EVENTS includes account.updated', () => {
    expect(STRIPE_WEBHOOK_EVENTS).toContain('account.updated');
  });

  it('STRIPE_WEBHOOK_EVENTS includes account.application.deauthorized', () => {
    expect(STRIPE_WEBHOOK_EVENTS).toContain('account.application.deauthorized');
  });
});

// =====================================================
// 4. Webhook handler — seller schema routing
// =====================================================

describe('Webhook handler — seller schema routing', () => {
  const webhookSource = readSource('app/api/webhooks/stripe/route.ts');

  it('extracts seller_schema from session metadata', () => {
    expect(webhookSource).toContain("session.metadata?.seller_schema");
  });

  it('validates seller_schema with isValidSellerSchema before using', () => {
    // isValidSellerSchema is imported
    expect(webhookSource).toContain("import { isValidSellerSchema }");
    // and called before getServiceClient
    const validateIndex = webhookSource.indexOf('isValidSellerSchema(sellerSchema)');
    const serviceClientIndex = webhookSource.indexOf('getServiceClient(sellerSchema)');
    expect(validateIndex).toBeGreaterThan(-1);
    expect(serviceClientIndex).toBeGreaterThan(-1);
    expect(validateIndex).toBeLessThan(serviceClientIndex);
  });

  it('handles account.updated event (calls handleAccountUpdated)', () => {
    expect(webhookSource).toContain("case 'account.updated'");
    expect(webhookSource).toContain('handleAccountUpdated(account)');
  });

  it('handles account.application.deauthorized event (calls handleAccountDeauthorized)', () => {
    expect(webhookSource).toContain("case 'account.application.deauthorized'");
    expect(webhookSource).toContain('handleAccountDeauthorized(connectedAccountId)');
  });
});

// =====================================================
// 5. CheckoutSellerInfo type completeness
// =====================================================

describe('CheckoutSellerInfo type', () => {
  it('has stripeAccountId field', () => {
    const seller: CheckoutSellerInfo = {
      stripeAccountId: 'acct_test',
      platformFeePercent: 5,
      sellerSlug: 'test',
      schemaName: 'seller_test',
    };
    expect(seller.stripeAccountId).toBe('acct_test');
  });

  it('has platformFeePercent field', () => {
    const seller: CheckoutSellerInfo = {
      stripeAccountId: 'acct_test',
      platformFeePercent: 10,
      sellerSlug: 'test',
      schemaName: 'seller_test',
    };
    expect(seller.platformFeePercent).toBe(10);
  });

  it('has sellerSlug field', () => {
    const seller: CheckoutSellerInfo = {
      stripeAccountId: 'acct_test',
      platformFeePercent: 5,
      sellerSlug: 'my-shop',
      schemaName: 'seller_my_shop',
    };
    expect(seller.sellerSlug).toBe('my-shop');
  });

  it('has schemaName field', () => {
    const seller: CheckoutSellerInfo = {
      stripeAccountId: 'acct_test',
      platformFeePercent: 5,
      sellerSlug: 'test',
      schemaName: 'seller_test',
    };
    expect(seller.schemaName).toBe('seller_test');
  });

  it('integrates with CheckoutSessionOptions as optional seller field', () => {
    const options: CheckoutSessionOptions = {
      product: {
        id: 'prod-1',
        slug: 'test',
        name: 'Test',
        description: null,
        price: 10,
        currency: 'USD',
        is_active: true,
        available_from: null,
        available_until: null,
        vat_rate: null,
        price_includes_vat: false,
      },
      returnUrl: 'https://example.com/return',
      seller: {
        stripeAccountId: 'acct_seller',
        platformFeePercent: 5,
        sellerSlug: 'nick',
        schemaName: 'seller_nick',
      },
    };

    expect(options.seller?.stripeAccountId).toBe('acct_seller');
  });

  it('CreateCheckoutRequest includes optional sellerSlug field', () => {
    const request: CreateCheckoutRequest = {
      productId: 'prod-1',
      sellerSlug: 'nick',
    };

    expect(request.sellerSlug).toBe('nick');
  });
});
