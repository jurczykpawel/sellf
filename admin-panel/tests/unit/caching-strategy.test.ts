import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Caching strategy guard: pin which routes are static / ISR / dynamic so
// regressions don't quietly turn the whole app into per-request DB queries
// (we already paid for that in production when a 1 GB box OOM'd).

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

describe('public listing pages use ISR with a sensible revalidate window', () => {
  it.each([
    ['src/app/[locale]/page.tsx', 300],
    ['src/app/[locale]/store/page.tsx', 300],
  ])('%s declares ISR with revalidate >= %d', (path, minSeconds) => {
    const source = read(path);
    const match = source.match(/export const revalidate\s*=\s*(\d+)/);
    expect(match, `${path} missing revalidate export`).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(minSeconds);
  });
});

describe('product page wraps getProduct in unstable_cache (cached across requests)', () => {
  const source = read('src/app/[locale]/p/[slug]/page.tsx');

  it('imports unstable_cache from next/cache', () => {
    expect(source).toMatch(/from\s+['"]next\/cache['"]/);
    expect(source).toContain('unstable_cache');
  });

  it('caches the product query so repeat hits skip the DB', () => {
    expect(source).toMatch(/unstable_cache\s*\(/);
    expect(source).toMatch(/['"]product-by-slug['"]/);
    expect(source).toMatch(/revalidate:\s*60/);
  });
});

describe('shop_config and integrations have cross-request cache (not just per-render)', () => {
  const shopSource = read('src/lib/actions/shop-config.ts');
  const integrationsSource = read('src/lib/actions/integrations.ts');

  it('getShopConfig is wrapped in unstable_cache as a Next.js fallback to Redis', () => {
    // React cache() dedupes per-render only. unstable_cache persists across
    // requests in Next.js memory — keeps DB out of the hot path even when
    // Upstash Redis is not configured.
    expect(shopSource).toMatch(/unstable_cache/);
    expect(shopSource).toMatch(/revalidate:\s*(60|300|600)/);
  });

  it('getPublicIntegrationsConfig is wrapped in unstable_cache', () => {
    expect(integrationsSource).toMatch(/unstable_cache/);
    expect(integrationsSource).toMatch(/revalidate:\s*(60|300|600)/);
  });
});
