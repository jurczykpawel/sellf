import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Second client-side loader was "Loading secure content..." in
// ProductAccessView while it fetched /api/public/products/[slug]/content
// for the protected content_config + shop branding. The server already
// knows everything that endpoint returns at the point of access decision —
// hand it to ProductAccessView as a prop so the first paint is the final
// state.

const pageSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/p/[slug]/page.tsx'),
  'utf-8',
);
const accessViewSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/p/[slug]/components/ProductAccessView.tsx'),
  'utf-8',
);

describe('ProductAccessView consumes server-prefetched secure data', () => {
  it('declares an optional initialSecureData prop', () => {
    expect(accessViewSource).toMatch(/initialSecureData\?:\s*SecureProductResponse/);
  });

  it('skips the client fetch when initialSecureData is present', () => {
    // The fetch effect must short-circuit when the server already provided data.
    expect(accessViewSource).toMatch(/if\s*\(\s*initialSecureData\s*\)/);
  });

  it('still falls back to the fetch when no initial data is provided (e.g. preview mode bypass paths)', () => {
    expect(accessViewSource).toContain("/api/public/products/${product.slug}/content");
  });
});

describe('page.tsx prefetches secure content server-side on render-content outcomes', () => {
  it('imports getShopConfig (used to build the branding object that the endpoint returned)', () => {
    expect(pageSource).toContain("from '@/lib/actions/shop-config'");
  });

  it('builds initialSecureData when outcome.kind is render-content and user owns access', () => {
    expect(pageSource).toMatch(/outcome\.kind\s*===\s*['"]render-content['"]/);
    expect(pageSource).toMatch(/initialSecureData/);
  });

  it('passes initialSecureData down to ProductView', () => {
    expect(pageSource).toMatch(/<ProductView[\s\S]*?initialSecureData=\{/);
  });
});
