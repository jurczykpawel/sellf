import { describe, it, expect, vi } from 'vitest';
import { revokeLicensesForOrder } from '@/lib/license-keys/revoke';

function adminMock(result: { data: unknown; error: unknown }) {
  const chain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(() => Promise.resolve(result)),
  };
  const from = vi.fn(() => chain);
  return { from, chain };
}

const call = (admin: { from: unknown }, params: { productId: string; orderIds: (string | null | undefined)[] }) =>
  revokeLicensesForOrder(admin as never, params);

describe('revokeLicensesForOrder', () => {
  it('flips revoked_at for matching product + orders and returns the count', async () => {
    const { from, chain } = adminMock({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    const res = await call({ from }, { productId: 'p1', orderIds: ['pi_1', 'cs_1'] });
    expect(res.revoked).toBe(2);
    expect(from).toHaveBeenCalledWith('issued_licenses');
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ revoked_at: expect.any(String) }));
    expect(chain.eq).toHaveBeenCalledWith('product_id', 'p1');
    expect(chain.in).toHaveBeenCalledWith('order_id', ['pi_1', 'cs_1']);
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null); // only un-revoked rows → idempotent
  });

  it('returns the revoked rows so the caller can fire license.revoked', async () => {
    const rows = [{ id: 'a', product_id: 'p1', order_id: 'pi_1', seller_id: 's1' }];
    const { from } = adminMock({ data: rows, error: null });
    const res = await call({ from }, { productId: 'p1', orderIds: ['pi_1'] });
    expect(res.rows).toEqual(rows);
  });

  it('dedupes and drops empty order ids', async () => {
    const { from, chain } = adminMock({ data: [{ id: 'a' }], error: null });
    await call({ from }, { productId: 'p1', orderIds: ['pi_1', 'pi_1', null, undefined, ''] });
    expect(chain.in).toHaveBeenCalledWith('order_id', ['pi_1']);
  });

  it('is a no-op (no query) when there are no usable order ids', async () => {
    const { from } = adminMock({ data: [], error: null });
    const res = await call({ from }, { productId: 'p1', orderIds: [null, undefined, ''] });
    expect(res.revoked).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('throws on a db error so a retriable webhook is redelivered', async () => {
    const { from } = adminMock({ data: null, error: { message: 'boom' } });
    await expect(call({ from }, { productId: 'p1', orderIds: ['pi_1'] }))
      .rejects.toThrow('License revocation failed');
  });
});
