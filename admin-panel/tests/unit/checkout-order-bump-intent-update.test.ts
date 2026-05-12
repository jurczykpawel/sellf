import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const paidProductFormSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx'),
  'utf-8'
);

const createPaymentIntentSource = readFileSync(
  resolve(__dirname, '../../src/app/api/create-payment-intent/route.ts'),
  'utf-8'
);

describe('checkout order bump Checkout Session refresh', () => {
  it('uses CheckoutElementsProvider and remounts when a new Checkout Session is created', () => {
    expect(paidProductFormSource).toContain('CheckoutElementsProvider');
    expect(paidProductFormSource).toContain('checkoutSessionId');
    expect(paidProductFormSource).toContain('key={`${product.id}-${checkoutSessionId || clientSecret}-${resolvedTheme}`');
    expect(paidProductFormSource).not.toContain('<Elements');
  });

  it('creates a fresh Checkout Session when checkout composition changes', () => {
    expect(paidProductFormSource).toContain('lastCheckoutSessionSignature');
    expect(paidProductFormSource).toContain('setCheckoutSessionId(data.checkoutSessionId)');
    expect(paidProductFormSource).not.toContain('elementsUpdateRevision');
    expect(paidProductFormSource).not.toContain('fetchUpdates');

    expect(createPaymentIntentSource).toContain('checkout.sessions.create(checkoutSessionParams)');
    expect(createPaymentIntentSource).not.toContain('paymentIntents.update(existingPaymentIntentId');
  });
});
