import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Wiring assertions: verify that the components and routes which gate access
 * are still wired to their respective decision points. These tests do not
 * render anything — they just guard against accidental refactors that break
 * the decision-to-render link.
 *
 * They complement:
 *   - tests/api/products-public-expiry.test.ts (server-side decision logic)
 *   - tests/unit/access/filter-active.test.ts (pure filter rule)
 */

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Access wiring', () => {
  // ProductView now consumes a server-resolved ProductAccessOutcome instead of
  // switching on accessData.reason from a client fetch. The render paths stay
  // identical; the input shape changed.
  it('ProductView renders ProductExpiredState on outcome.kind="render-expired"', () => {
    const src = read('src/app/[locale]/p/[slug]/components/ProductView.tsx');
    expect(src).toMatch(/import\s+ProductExpiredState\s+from/);
    expect(src).toMatch(/outcome\.kind\s*===\s*['"]render-expired['"][\s\S]+?<ProductExpiredState/);
  });

  it('ProductView renders ProductInactiveState on outcome.kind="render-inactive"', () => {
    const src = read('src/app/[locale]/p/[slug]/components/ProductView.tsx');
    expect(src).toMatch(/outcome\.kind\s*===\s*['"]render-inactive['"][\s\S]+?<ProductInactiveState/);
  });

  it('ProductView renders ProductTemporalState on outcome.kind="render-temporal"', () => {
    const src = read('src/app/[locale]/p/[slug]/components/ProductView.tsx');
    expect(src).toMatch(/outcome\.kind\s*===\s*['"]render-temporal['"][\s\S]+?<ProductTemporalState/);
  });

  it('my-products page uses filterActiveAccess (no inline filter)', () => {
    const src = read('src/app/[locale]/my-products/page.tsx');
    expect(src).toMatch(/from\s+['"]@\/lib\/access\/filter-active['"]/);
    // Allow optional generic type arguments: filterActiveAccess<...>(...)
    expect(src).toMatch(/filterActiveAccess(?:<[^>]+>)?\s*\(/);
    // Inline filter on access_expires_at would be a regression — the rule
    // must live in the shared module so server / client / mobile stay in sync.
    expect(src).not.toMatch(/access_expires_at\s*\)\s*<\s*new Date/);
  });

  it('p/[slug]/page.tsx strips content_config before passing to ProductView', () => {
    // Defense-in-depth: protected URLs must not be in the initial server render.
    const src = read('src/app/[locale]/p/[slug]/page.tsx');
    expect(src).toMatch(/safeProduct/);
    expect(src).toMatch(/content_config:\s*previewMode/);
  });

  it('p/[slug]/page.tsx never issues licenses during page render', () => {
    const src = read('src/app/[locale]/p/[slug]/page.tsx');
    expect(src).not.toMatch(/from\s+['"]@\/lib\/license-keys\/issue['"]/);
    expect(src).not.toMatch(/\bissueLicense\s*\(/);
    expect(src).not.toMatch(/renew_/);
  });

  it('p/[slug]/page.tsx prefetches license for expired-access state without issuing a new one', () => {
    const src = read('src/app/[locale]/p/[slug]/page.tsx');
    expect(src).toMatch(/from\s+['"]@\/lib\/license-keys\/lookup['"]/);
    expect(src).toMatch(/outcome\.kind\s*===\s*['"]render-expired['"]/);
    expect(src).toMatch(/existingLicense/);
    expect(src).toMatch(/<ProductView[\s\S]+existingLicense=\{existingLicense\}/);
    expect(src).not.toMatch(/function\s+loadExistingLicenseForUser/);
  });

  it('ProductExpiredState can display an existing issued license while offering repurchase', () => {
    const src = read('src/app/[locale]/p/[slug]/components/ProductExpiredState.tsx');
    expect(src).toMatch(/existingLicense/);
    expect(src).toMatch(/licenseKey/);
    expect(src).toMatch(/navigator\.clipboard\.writeText/);
    expect(src).toMatch(/licenseCopied/);
    expect(src).toMatch(/purchaseAgain/);
  });

  it('ProductAccessView offers license renewal when content access is active but license is expired', () => {
    const src = read('src/app/[locale]/p/[slug]/components/ProductAccessView.tsx');
    expect(src).toMatch(/licenseExpired/);
    expect(src).toMatch(/repurchase=1/);
    expect(src).toMatch(/licenseExpiredTitle/);
  });

  it('checkout sends explicit repurchase intent from ?repurchase=1 or ?renew_license=1', () => {
    const src = read('src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx');
    expect(src).toMatch(/renewLicense/);
    expect(src).toMatch(/repurchase/);
    expect(src).toMatch(/explicitRepurchase/);
    expect(src).toMatch(/searchParams\.get\(['"]renew_license['"]\)\s*===\s*['"]1['"]/);
    expect(src).toMatch(/searchParams\.get\(['"]repurchase['"]\)\s*===\s*['"]1['"]/);
  });

  it('create-payment-intent allows active-access checkout only through explicit repurchase policy', () => {
    const src = read('src/app/api/create-payment-intent/route.ts');
    expect(src).toMatch(/from\s+['"]@\/lib\/license-keys\/lookup['"]/);
    expect(src).toMatch(/canRenewExpiredLicenseWithActiveAccess/);
    expect(src).toMatch(/explicitRepurchase/);
    expect(src).toMatch(/canRepurchaseTipJar/);
    expect(src).toMatch(/product\.product_type\s*!==\s*['"]subscription['"]/);
    expect(src).toMatch(/renew_license:\s*canRenewLicense\s*\?\s*['"]true['"]/);
    expect(src).toMatch(/repurchase:\s*explicitRepurchase\s*\?\s*['"]true['"]/);
    expect(src).not.toMatch(/function\s+loadLatestIssuedLicenseExpiresAt/);
  });

  it('stripe webhook emits purchase.completed for explicit repurchases despite already_had_access', () => {
    const src = read('src/app/api/webhooks/stripe/route.ts');
    expect(src).toMatch(/renew_license/);
    expect(src).toMatch(/repurchase/);
    expect(src).toMatch(/isExplicitRepurchase/);
    expect(src).toMatch(/!result\.already_had_access\s*\|\|\s*isExplicitRepurchase/);
  });

  it('public access endpoint returns reason="expired" for expired access', () => {
    const src = read('src/app/api/public/products/[slug]/access/route.ts');
    expect(src).toMatch(/reason:\s*['"]expired['"]/);
    expect(src).toMatch(/expiresAt\s*<\s*now/);
  });

  it('public content endpoint independently denies expired access', () => {
    const src = read('src/app/api/public/products/[slug]/content/route.ts');
    expect(src).toMatch(/Access expired/);
    expect(src).toMatch(/isExpired/);
    expect(src).toMatch(/status:\s*403/);
  });

  it('public content endpoint fetches issued licenses without raw PostgREST or() filters', () => {
    const src = read('src/app/api/public/products/[slug]/content/route.ts');
    const helper = read('src/lib/license-keys/lookup.ts');
    expect(src).toMatch(/from\s+['"]@\/lib\/license-keys\/lookup['"]/);
    expect(helper).toMatch(/from\(['"]issued_licenses['"]\)/);
    expect(helper).toMatch(/\.eq\(['"]user_id['"],\s*user\.id\)/);
    expect(helper).toMatch(/\.is\(['"]user_id['"],\s*null\)/);
    expect(helper).toMatch(/\.eq\(['"]email['"],\s*user\.email\)/);
    expect(helper).not.toMatch(/\.or\(\s*`[^`]*(?:email|user)/);
  });
});
