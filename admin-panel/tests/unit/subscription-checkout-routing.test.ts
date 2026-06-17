import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  formatBillingIntervalLabel,
  formatRecurringProductPrice,
} from '@/lib/product-pricing-display';

const productPurchaseViewSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/checkout/[slug]/components/ProductPurchaseView.tsx'),
  'utf-8'
);

const productShowcaseSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/checkout/[slug]/components/ProductShowcase.tsx'),
  'utf-8'
);

const productsTableSource = readFileSync(
  resolve(__dirname, '../../src/components/ProductsTable.tsx'),
  'utf-8'
);

const createPaymentIntentSource = readFileSync(
  resolve(__dirname, '../../src/app/api/create-payment-intent/route.ts'),
  'utf-8'
);

const paidProductFormSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx'),
  'utf-8'
);

describe('subscription checkout and price display routing', () => {
  it('does not route subscription products with price=0 through the free checkout form', () => {
    expect(productPurchaseViewSource).toContain("product.product_type !== 'subscription' && product.price === 0");
  });

  it('uses recurring subscription price in admin table and checkout showcase displays', () => {
    expect(productsTableSource).toContain('formatRecurringProductPrice(product, locale)');
    expect(productsTableSource).toContain("t('subscription')");
    expect(productShowcaseSource).toContain('formatRecurringProductPrice(product, locale');
    expect(productShowcaseSource).toContain('!isSubscription &&');
  });

  it('handles subscription products before one-time PWYW, coupon, and bump pricing in create-payment-intent', () => {
    const subscriptionBranch = createPaymentIntentSource.indexOf("if (product.product_type === 'subscription')");
    const customAmountValidation = createPaymentIntentSource.indexOf('validateCustomAmount(customAmount, product)');
    const oneTimePricing = createPaymentIntentSource.indexOf('const pricing = calculatePricing({');

    expect(subscriptionBranch).toBeGreaterThan(-1);
    expect(subscriptionBranch).toBeLessThan(customAmountValidation);
    expect(subscriptionBranch).toBeLessThan(oneTimePricing);
    expect(createPaymentIntentSource).toContain('buildSubscriptionSessionConfig');
    expect(createPaymentIntentSource).toContain("uiMode: 'elements'");
  });

  it('hides one-time-only controls (coupons, bumps, free-access path) for subscriptions but allows PWYW for PWYW subscriptions', () => {
    expect(paidProductFormSource).toContain('const isSubscription = product.product_type ===');
    // Phase 3c — PWYW subscriptions render the amount picker so the buyer can
    // choose the monthly amount. Coupons + bumps + free-access path remain
    // disabled because they aren't supported by the subscription Stripe flow.
    expect(paidProductFormSource).toContain('const isPwywSubscription =');
    expect(paidProductFormSource).toContain('{(!isSubscription || isPwywSubscription) && (');
    expect(paidProductFormSource).toContain('{!isSubscription && !hasAccess && !error && !isFreeAccess');
    expect(paidProductFormSource).toContain('{!isSubscription && !hasAccess && !error && !isPwywFree');
    // Subscriptions still bill the recurring price; one-time products bill the
    // effective unit price (active sale price when running, else regular price).
    expect(paidProductFormSource).toContain('? product.recurring_price ?? 0');
    expect(paidProductFormSource).toContain(': getEffectiveUnitPrice(product)');
    expect(paidProductFormSource).toContain('productPrice: effectiveUnitPrice');
  });

  it('formats subscription recurring price without falling back to free one-time price', () => {
    const display = formatRecurringProductPrice({
      product_type: 'subscription',
      recurring_price: 49,
      currency: 'PLN',
      billing_interval: 'month',
      billing_interval_count: 1,
    }, 'pl');

    // Decimal separator depends on Node locale (pl uses ",", en uses "."), so
    // assert structure rather than the exact glyph.
    expect(display).toMatch(/^zł49[.,]00 \/ mies\.$/);
  });

  it('formats multi-period subscription intervals', () => {
    expect(formatBillingIntervalLabel('month', 3, 'pl')).toBe('co 3 mies.');
    expect(formatBillingIntervalLabel('year', 2, 'en')).toBe('every 2 years');
  });
});
