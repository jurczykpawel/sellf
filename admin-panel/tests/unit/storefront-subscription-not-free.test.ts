import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Subscriptions have products.price=0 (price lives in recurring_price). The
// storefront and the free/paid split must guard on product_type, otherwise
// subscriptions show as "free" with a Get free access button.

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

describe('storefront does not label subscriptions as free', () => {
  it('SmartLandingClient excludes subscriptions from freeProducts bucket', () => {
    const source = read('src/components/storefront/SmartLandingClient.tsx');
    expect(source).toMatch(
      /freeProducts\s*=\s*products\.filter\([\s\S]+?product_type\s*!==\s*['"]subscription['"][\s\S]+?price\s*===\s*0/,
    );
  });

  it('SmartLandingClient includes subscriptions in paidProducts bucket', () => {
    const source = read('src/components/storefront/SmartLandingClient.tsx');
    expect(source).toMatch(
      /paidProducts\s*=\s*products\.filter\([\s\S]+?product_type\s*===\s*['"]subscription['"][\s\S]+?price\s*>\s*0/,
    );
  });

  it('Storefront isFree gates on !isSubscription before product.price===0', () => {
    const source = read('src/components/storefront/Storefront.tsx');
    expect(source).toMatch(/isSubscription\s*=\s*product\.product_type\s*===\s*['"]subscription['"]/);
    expect(source).toMatch(/isFree\s*=\s*!isSubscription\s*&&\s*product\.price\s*===\s*0/);
  });

  it('Storefront renders recurring price for subscriptions (not the "free" label)', () => {
    const source = read('src/components/storefront/Storefront.tsx');
    expect(source).toContain('formatRecurringProductPrice');
    expect(source).toMatch(/isSubscription[\s\S]+?recurringPriceDisplay/);
  });
});
