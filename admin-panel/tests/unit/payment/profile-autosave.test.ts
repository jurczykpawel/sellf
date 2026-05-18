import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// After a successful one-time purchase we copy the buyer's name + invoice
// fields from payment metadata into their profile so the next checkout in a
// funnel doesn't ask them to retype. Both verifyPaymentSession (embedded
// Stripe Checkout) and verifyPaymentIntent (custom Payment Element flow)
// must run this update for logged-in buyers — they used to differ.

const verifyPaymentSource = readFileSync(
  resolve(__dirname, '../../../src/lib/payment/verify-payment.ts'),
  'utf-8',
);

const paymentStatusSource = readFileSync(
  resolve(
    __dirname,
    '../../../src/app/[locale]/p/[slug]/payment-status/page.tsx',
  ),
  'utf-8',
);

function extractFunctionBody(source: string, exportName: string): string {
  const idx = source.indexOf(`export async function ${exportName}`);
  expect(idx, `${exportName} not found in verify-payment.ts`).toBeGreaterThan(-1);

  // Find the next `export async function` (or EOF). Naive but fine here —
  // we only have two exported functions in this file.
  const nextIdx = source.indexOf('export async function ', idx + 1);
  return source.slice(idx, nextIdx === -1 ? undefined : nextIdx);
}

describe('Profile auto-save on purchase', () => {
  describe('verifyPaymentSession', () => {
    it('calls updateProfileWithCompanyData for logged-in buyers', () => {
      const body = extractFunctionBody(verifyPaymentSource, 'verifyPaymentSession');
      expect(body).toContain('updateProfileWithCompanyData(');
    });
  });

  describe('verifyPaymentIntent', () => {
    it('calls updateProfileWithCompanyData for logged-in buyers (regression)', () => {
      const body = extractFunctionBody(verifyPaymentSource, 'verifyPaymentIntent');
      expect(body).toContain('updateProfileWithCompanyData(');
    });
  });
});

describe('Funnel name pass-through', () => {
  it('payment-status passes customerName to buildOtoRedirectUrl', () => {
    // The page must read fullName from payment_transactions metadata and
    // forward it as customerName so the next checkout pre-fills the form.
    // Accept either `customerName: foo` or shorthand `customerName,` /
    // `customerName }` — both are valid object-literal forms.
    expect(paymentStatusSource).toMatch(
      /buildOtoRedirectUrl\(\{[\s\S]+?customerName\s*[:,}]/,
    );
  });
});
