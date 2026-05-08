import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const myProductsSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/my-products/page.tsx'),
  'utf-8'
);

const myPurchasesSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/my-purchases/page.tsx'),
  'utf-8'
);

describe('customer product and purchase pages', () => {
  it('keeps access expiration visible on my-products cards', () => {
    expect(myProductsSource).toContain('access_expires_at');
    expect(myProductsSource).toContain('expires_at: a.access_expires_at');
    expect(myProductsSource).toContain("t('accessExpires'");
  });

  it('loads payment line items so bundled purchases show their composition', () => {
    expect(myPurchasesSource).toContain(".from('payment_line_items')");
    expect(myPurchasesSource).toContain('normalizePurchaseLineItems');
    expect(myPurchasesSource).toContain('requiresManualRefundReview');
    expect(myPurchasesSource).toContain('mixedRefundPolicyNotice');
  });
});
