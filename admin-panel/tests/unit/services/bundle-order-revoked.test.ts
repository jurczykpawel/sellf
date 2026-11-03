/** A license born revoked by an open dispute never reaches the purchase webhook with its token. */
import { expect, it, vi } from 'vitest';
const issue = vi.hoisted(() => vi.fn());
vi.mock('@/lib/license-keys/issue', () => ({ issueLicense: issue }));
vi.mock('@/lib/utils/canonical-url', () => ({ getCanonicalOriginOrNull: () => 'https://shop.example' }));
import { issueLicensesForOrder } from '@/lib/services/bundle-order';

it('omits licenses revoked at issuance from the purchase payload', async () => {
  issue.mockImplementation(async (_db, input: { productId: string }) => ({ id: `lic-${input.productId}`, token: `tok-${input.productId}`, kid: 'k', sellerId: 's' }));
  const q = { select: () => q, eq: () => q, not: async () => ({ data: [{ id: 'lic-b' }], error: null }) };
  const db = { from: vi.fn(() => q) };
  const result = await issueLicensesForOrder(db as never, { productIds: ['a', 'b'], email: 'x@example.com', userId: null, orderId: 'pi_1' });
  expect(result.map(l => l.token)).toEqual(['tok-a']);
  expect(db.from).toHaveBeenCalledWith('issued_licenses');
});
