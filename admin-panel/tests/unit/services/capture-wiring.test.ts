import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard for the VAT-capture WIRING at every completion entry point.
 *
 * The capture function (captureAndPersistOrderTax / …InvoiceTax) is verified at runtime against
 * the real DB (tax-snapshot-persist.integration + subscription-handlers.integration), and the
 * net/gross RPC against the real SQL function (payment-completion-rpc). What these source-level
 * assertions add is a guard that each entry point still WIRES that proven machinery — catching
 * the exact regressions flagged in review (someone drops amount_subtotal_param, removes the
 * capture call, stops passing the snapshot to the payload, or loses the PI→session resolution).
 * Matches the repo's existing source-level handler tests (checkout-session-subscription-skip).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const route = read('src/app/api/webhooks/stripe/route.ts');
const verify = read('src/lib/payment/verify-payment.ts');
const updateMeta = read('src/app/api/update-payment-metadata/route.ts');

describe('VAT capture wiring — completion entry points', () => {
  it('webhook session + PI handlers both call captureAndPersistOrderTax', () => {
    expect((route.match(/captureAndPersistOrderTax/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('verify-payment session + PI paths both call captureAndPersistOrderTax', () => {
    expect((verify.match(/captureAndPersistOrderTax/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('net-priced validation: amount_subtotal_param is passed to the completion RPC (both paths)', () => {
    expect(route).toMatch(/amount_subtotal_param/);
    expect(verify).toMatch(/amount_subtotal_param/);
  });

  it('the captured snapshot is threaded into the purchase webhook payload', () => {
    expect(route).toMatch(/taxSnapshot/);
    expect(verify).toMatch(/taxSnapshot/);
  });

  it('PI→session resolution: capture receives paymentIntentId so the real cs_ can be resolved', () => {
    expect(route).toMatch(/paymentIntentId/);
    expect(verify).toMatch(/paymentIntentId/);
  });

  it('stripe_tax: buyer tax identity is applied where the fields actually arrive (update-payment-metadata)', () => {
    expect(updateMeta).toMatch(/applyBuyerTaxIdentityToCustomer/);
    expect(updateMeta).toMatch(/shouldForwardTaxIdentityToStripe/);
  });
});
