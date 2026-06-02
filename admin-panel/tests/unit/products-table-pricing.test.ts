import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ProductsTable pricing labels', () => {
  it('renders PWYW before FREE when allow_custom_price=true and price=0', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/ProductsTable.tsx'), 'utf8');
    const pwywBranch = src.indexOf('product.allow_custom_price ?');
    const freeBranch = src.indexOf('product.price === 0 ?');

    expect(pwywBranch).toBeGreaterThan(-1);
    expect(freeBranch).toBeGreaterThan(-1);
    expect(pwywBranch).toBeLessThan(freeBranch);
  });
});
