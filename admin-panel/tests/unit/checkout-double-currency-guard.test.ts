/**
 * Guard against the "zł20.00 PLN" regression.
 *
 * `formatPrice(price, currency)` already returns the currency symbol prefix
 * (e.g. "zł20.00"). Concatenating " {currency}" after it produces
 * "zł20.00 PLN" — visually redundant, looks broken to users. This file pins
 * the rule across every user-facing checkout file.
 *
 * Admin-side files (ProductsTable, my-products, my-purchases, etc.) are
 * intentionally exempt: admins often see multiple currencies and the ISO
 * code disambiguates $-sharing currencies (USD/CAD/AUD/etc.).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../', relativePath), 'utf-8');
}

// Source files that render checkout/storefront UI for end customers.
const CHECKOUT_FACING_FILES = [
  'src/app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx',
  'src/app/[locale]/checkout/[slug]/components/ProductShowcase.tsx',
  'src/app/[locale]/checkout/[slug]/components/PwywSection.tsx',
  'src/app/[locale]/checkout/[slug]/components/OrderBumpList.tsx',
  'src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx',
  'src/components/checkout/OrderSummary.tsx',
  'src/components/storefront/Storefront.tsx',
];

// The forbidden pattern: `formatPrice(..., X)} {X}` — concatenating the same
// currency code right after the symbol-formatted price.
//
// We match the most common shapes:
//   {formatPrice(x, currency)} {currency}
//   {formatPrice(x, product.currency)} {product.currency}
//   {formatPrice(x, bump.bump_currency)} {bump.bump_currency}
//   `${formatPrice(x, foo)} ${foo}`
const DOUBLE_CURRENCY_PATTERNS: RegExp[] = [
  /\{formatPrice\([^)]+,\s*([^)\s]+)\)\}\s*\{(\1)\}/,
  /`\$\{formatPrice\([^)]+,\s*([^)]+)\)\}\s+\$\{(\1)\}/,
];

describe('user-facing checkout components do not double-print the currency code', () => {
  it.each(CHECKOUT_FACING_FILES)('%s', (path) => {
    const source = read(path);
    for (const pattern of DOUBLE_CURRENCY_PATTERNS) {
      const match = source.match(pattern);
      expect(
        match,
        match
          ? `Found "{formatPrice(...)} {currency}" pattern in ${path}: "${match[0]}". formatPrice already includes the currency symbol — remove the trailing " {currency}".`
          : '',
      ).toBeNull();
    }
  });
});

describe('checkout call sites of formatRecurringProductPrice use the default (no currency code)', () => {
  it('ProductShowcase does not pass includeCurrencyCode: true', () => {
    const source = read('src/app/[locale]/checkout/[slug]/components/ProductShowcase.tsx');
    expect(source).toContain('formatRecurringProductPrice(product, locale)');
    expect(source).not.toMatch(/includeCurrencyCode:\s*true/);
  });
});

describe('OrderSummary shape', () => {
  const source = read('src/components/checkout/OrderSummary.tsx');

  it('accepts an optional intervalLabel prop and renders it after the total', () => {
    expect(source).toMatch(/intervalLabel\?:\s*string/);
    // The total block renders "{ price }{ intervalLabel && / label }" together.
    expect(source).toMatch(
      /\{formatPrice\(totalGross, currency\)\}\s*\n\s*\{intervalLabel && [\s\S]+?\/\s*\{intervalLabel\}/,
    );
  });

  it('does not append the currency code to net/total/breakdown lines', () => {
    // Lift the pattern from the guard above for clarity in this dedicated test.
    expect(source).not.toMatch(/\{formatPrice\(\w+,\s*currency\)\}\s*\{currency\}/);
  });
});
