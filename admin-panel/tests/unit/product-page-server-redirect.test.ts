import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Guard: /p/[slug] resolves access on the server and either Next-redirects
// to checkout or hands the outcome to ProductView as a prop. No spinner-
// flicker, no client-side fetch('/api/.../access') on every visit.

const pageSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/p/[slug]/page.tsx'),
  'utf-8',
);
const viewSource = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/p/[slug]/components/ProductView.tsx'),
  'utf-8',
);

describe('product page resolves access server-side', () => {
  it('imports the decision module and resolves outcome before rendering ProductView', () => {
    expect(pageSource).toContain("from '@/lib/payment/product-access-decision'");
    expect(pageSource).toMatch(/decideProductAccessOutcome\s*\(/);
  });

  it('calls Next redirect() to /checkout/{slug} on the redirect-checkout outcome', () => {
    expect(pageSource).toContain("from 'next/navigation'");
    expect(pageSource).toMatch(/['"]redirect-checkout['"][\s\S]+?redirect\(/);
  });

  it('passes the resolved outcome to ProductView as a prop', () => {
    expect(pageSource).toMatch(/<ProductView[\s\S]*?outcome=\{/);
  });
});

describe('ProductView accepts a server-resolved outcome and skips its own loading state', () => {
  it('declares an outcome prop typed as ProductAccessOutcome', () => {
    expect(viewSource).toContain("from '@/lib/payment/product-access-decision'");
    expect(viewSource).toMatch(/outcome:\s*ProductAccessOutcome/);
  });

  it('does not import useProductAccess (decision lives on the server now)', () => {
    expect(viewSource).not.toContain("from '@/hooks/useProductAccess'");
  });

  it('does not render ProductLoadingState as the access-pending state', () => {
    // ProductLoadingState may stay in the file for the redirect-content path,
    // but it must not be returned just because client-side access is loading.
    expect(viewSource).not.toMatch(/if\s*\(loading\)\s*\{?\s*return\s*<ProductLoadingState/);
  });

  it('switches on outcome.kind to render the right state', () => {
    expect(viewSource).toMatch(/outcome\.kind\s*===\s*['"]render-inactive['"]/);
    expect(viewSource).toMatch(/outcome\.kind\s*===\s*['"]render-temporal['"]/);
    expect(viewSource).toMatch(/outcome\.kind\s*===\s*['"]render-expired['"]/);
    expect(viewSource).toMatch(/outcome\.kind\s*===\s*['"]render-content['"]/);
  });
});
