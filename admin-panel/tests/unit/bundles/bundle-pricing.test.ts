import { describe, it, expect } from 'vitest';
import { computeBundleAnchor } from '@/lib/services/bundle-pricing';

describe('computeBundleAnchor', () => {
  it('savings mode when bundle price < component sum', () => {
    const r = computeBundleAnchor(199, [{ price: 149 }, { price: 199 }, { price: 99 }]);
    expect(r.componentsSum).toBe(447);
    expect(r.savings).toBe(248);
    expect(r.savingsPct).toBe(55); // round(248/447*100)
    expect(r.mode).toBe('savings');
  });

  it('included mode when bundle price >= component sum', () => {
    const r = computeBundleAnchor(300, [{ price: 100 }, { price: 100 }]);
    expect(r.mode).toBe('included');
    expect(r.savings).toBe(0);
    expect(r.savingsPct).toBe(0);
  });

  it('weights a PWYW component by its custom_price_min and a free component by 0', () => {
    const r = computeBundleAnchor(50, [
      { price: 0, allow_custom_price: true, custom_price_min: 30 },
      { price: 0 },
    ]);
    expect(r.componentsSum).toBe(30);
    expect(r.mode).toBe('included'); // 50 >= 30
  });

  it('uses the active sale price of a component as its weight', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const r = computeBundleAnchor(10, [{ price: 100, sale_price: 20, sale_price_until: future }]);
    expect(r.componentsSum).toBe(20);
    expect(r.mode).toBe('savings'); // 10 < 20
  });
});
