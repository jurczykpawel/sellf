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

describe('checkout order bump PaymentIntent updates', () => {
  it('does not key Stripe Elements by clientSecret', () => {
    expect(paidProductFormSource).not.toContain('key={`${product.id}-${clientSecret}-${resolvedTheme}`');
    expect(paidProductFormSource).toContain('key={`${product.id}-${resolvedTheme}`');
  });

  it('updates the existing PaymentIntent when checkout composition changes', () => {
    expect(paidProductFormSource).toContain('clientSecret: shouldUpdateExistingIntent ? clientSecret : undefined');
    expect(paidProductFormSource).toContain('elementsUpdateRevision');
    expect(paidProductFormSource).toContain('fetchUpdates');
    expect(createPaymentIntentSource).toContain('paymentIntents.update(existingPaymentIntentId');
  });
});
