import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('tip jar repurchase wiring', () => {
  it('checkout reads ?repurchase=1 and sends a generic repurchase intent', () => {
    const src = read('src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx');
    expect(src).toMatch(/searchParams\.get\(['"]repurchase['"]\)\s*===\s*['"]1['"]/);
    expect(src).toMatch(/repurchase/);
  });

  it('create-payment-intent allows active-access repurchase only for tip jars or license renewal', () => {
    const src = read('src/app/api/create-payment-intent/route.ts');
    expect(src).toMatch(/rawRepurchase/);
    expect(src).toMatch(/canRepurchaseTipJar/);
    expect(src).toMatch(/product\.checkout_template\s*===\s*['"]tip-jar['"]/);
    expect(src).toMatch(/!canRenewLicense\s*&&\s*!canRepurchaseTipJar/);
  });

  it('webhook emits purchase.completed for explicit repurchases despite existing access', () => {
    // one-time handlers extracted to onetime-handlers.ts (Option A).
    const src = read('src/app/api/webhooks/stripe/onetime-handlers.ts');
    expect(src).toMatch(/isExplicitRepurchase/);
    expect(src).toMatch(/metadata\?\.repurchase\s*===\s*['"]true['"]/);
    expect(src).toMatch(/!result\.already_had_access\s*\|\|\s*isExplicitRepurchase/);
  });
});
