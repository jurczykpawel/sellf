import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('tip-jar checkout layout', () => {
  it('embedded PaidProductForm uses full-width form instead of standalone half-column sizing', () => {
    const src = read('src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx');

    expect(src).toMatch(/layoutMode\s*===\s*['"]embedded['"]/);
    expect(src).toMatch(/checkoutFormClassName/);
    expect(src).toMatch(/layoutMode\s*===\s*['"]embedded['"]\s*\?\s*['"]w-full['"]/);
    expect(src).toMatch(/:\s*['"]w-full lg:w-1\/2 lg:pl-8['"]/);
  });
});
