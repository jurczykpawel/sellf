import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('recent supporters cache invalidation', () => {
  it('Stripe webhook revalidates recent-supporters and product slug tags after purchases', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/webhooks/stripe/route.ts'), 'utf8');
    expect(src).toMatch(/from\s+['"]next\/cache['"]/);
    expect(src).toMatch(/revalidateTag\(['"]recent-supporters['"],\s*\{\s*expire:\s*0\s*\}/);
    expect(src).toMatch(/revalidateTag\(`product:\$\{productSlug\}`,\s*\{\s*expire:\s*0\s*\}\)/);
  });
});
