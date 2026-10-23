import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// In an OTO/downsell funnel the second checkout receives ?email=... &name=...
// in the URL (set by buildOtoRedirectUrl). The form must read both and use
// them as defaults so the buyer doesn't retype.

const paidProductFormSource = readFileSync(
  resolve(
    __dirname,
    '../../src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx',
  ),
  'utf-8',
);

const customPaymentFormSource = readFileSync(
  resolve(
    __dirname,
    '../../src/app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx',
  ),
  'utf-8',
);

const useInvoiceDataSource = readFileSync(
  resolve(__dirname, '../../src/hooks/useInvoiceData.ts'),
  'utf-8',
);

describe('Checkout URL pre-fill — full name', () => {
  it('PaidProductForm reads ?name= from searchParams', () => {
    expect(paidProductFormSource).toMatch(/searchParams\.get\(['"]name['"]\)/);
  });

  it('PaidProductForm seeds shared invoice state with the URL name', () => {
    expect(paidProductFormSource).toMatch(/useInvoiceData\(email, \{ initialFullName: urlName \}\)/);
    expect(paidProductFormSource).toContain('invoice={invoice}');
  });

  it('CustomPaymentForm consumes the shared invoice state', () => {
    expect(customPaymentFormSource).toContain('invoice: ReturnType<typeof useInvoiceData>');
    expect(customPaymentFormSource).toContain('value={invoice.fullName}');
  });

  it('useInvoiceData accepts an initial fullName seed', () => {
    // Hook signature changes from (email) to (email, options) or similar —
    // we only assert the seed is wired through, not the exact shape.
    expect(useInvoiceDataSource).toMatch(/initialFullName/);
  });
});
