import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Public storefront/product/shop deadline behavior is exercised by the
// storefront bounded-cache and public-read runtime suites.

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

describe('integrations have cross-request cache', () => {
  const integrationsSource = read('src/lib/actions/integrations.ts');

  it('getPublicIntegrationsConfig is wrapped in unstable_cache', () => {
    expect(integrationsSource).toMatch(/unstable_cache/);
    expect(integrationsSource).toMatch(/revalidate:\s*(60|300|600)/);
  });
});
