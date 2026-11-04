/** Admin sidebar grouped into sales, products and system. @see src/lib/navigation/admin-nav.ts */
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_GROUPS } from '@/lib/navigation/admin-nav';

describe('admin navigation groups @J194', () => {
  it('has three groups in the owner-proposed order @J194', () => {
    expect(ADMIN_NAV_GROUPS.map(g => g.id)).toEqual(['sales', 'products', 'system']);
  });
  it('places sales handling, catalogue and system links in their groups', () => {
    const byId = Object.fromEntries(ADMIN_NAV_GROUPS.map(g => [g.id, g.items.map(i => i.href)]));
    expect(byId.sales).toEqual(expect.arrayContaining(['/dashboard', '/dashboard/payments', '/dashboard/refund-requests', '/dashboard/licenses', '/dashboard/users', '/dashboard/attribution']));
    expect(byId.products).toEqual(expect.arrayContaining(['/dashboard/products', '/dashboard/coupons', '/dashboard/order-bumps']));
    expect(byId.system).toEqual(expect.arrayContaining(['/dashboard/webhooks', '/dashboard/api-keys', '/dashboard/settings']));
  });
  it('lists every link exactly once', () => {
    const hrefs = ADMIN_NAV_GROUPS.flatMap(g => g.items.map(i => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(17);
  });
});
