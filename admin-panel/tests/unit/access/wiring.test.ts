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
    expect(src).toMatch(/from\(['"]issued_licenses['"]\)/);
    expect(src).toMatch(/\.eq\(['"]user_id['"],\s*user\.id\)/);
    expect(src).toMatch(/\.is\(['"]user_id['"],\s*null\)/);
    expect(src).toMatch(/\.eq\(['"]email['"],\s*userEmail\)/);
    expect(src).not.toMatch(/\.or\(\s*`[^`]*(?:email|user)/);
  });
});
