/** One orders list: paid, bank transfer, free, manual, subscription grants and leads; cursor pages. @see src/lib/orders/merge.ts */
import { describe, expect, it } from 'vitest';
import { compareOrders, decodeOrdersCursor, encodeOrdersCursor, isAfterCursor, mergeOrders, pageOrders } from '@/lib/orders/merge';

const products = new Map([
  ['p-paid', { name: 'Kurs', slug: 'kurs' }],
  ['p-free', { name: 'Poradnik', slug: 'poradnik' }],
]);
const access = (id: string, product: string, source: string, at: string, expires: string | null = null) =>
  ({ id, user_id: `u-${id}`, product_id: product, access_granted_at: at, access_expires_at: expires, grant_source: source });

describe('mergeOrders @J190', () => {
  const rows = mergeOrders({
    transactions: [
      { id: 't1', order_number: 1300, customer_email: 'a@x.pl', user_id: 'u1', product_id: 'p-paid', amount: 9900, currency: 'pln', status: 'completed', payment_provider: 'stripe', created_at: '2026-11-01T10:00:00Z' },
      { id: 't2', order_number: 1301, customer_email: 'b@x.pl', user_id: null, product_id: 'p-paid', amount: 9900, currency: 'pln', status: 'awaiting_payment', payment_provider: 'bank_transfer', created_at: '2026-11-02T10:00:00Z' },
    ],
    accesses: [
      access('a2', 'p-free', 'free', '2026-10-30T10:00:00Z'),
      // A paid product claimed with a 100% coupon is free, not manual: the source decides, not the price.
      access('a4', 'p-paid', 'free', '2026-10-29T12:00:00Z'),
      access('a3', 'p-paid', 'manual', '2026-10-29T10:00:00Z', '2026-10-30T00:00:00Z'),
      access('a5', 'p-paid', 'subscription', '2026-10-28T10:00:00Z'),
      access('a6', 'p-paid', 'unknown', '2026-10-27T10:00:00Z'),
    ],
    leads: [{ id: 'l1', email: 'lead@x.pl', product_id: 'p-free', confirmed_at: null, created_at: '2026-11-03T08:00:00Z' }],
    products,
    emails: new Map([['u-a2', 'free@x.pl'], ['u-a3', 'manual@x.pl']]),
    now: new Date('2026-11-03T12:00:00Z'),
  });

  it('classifies every source by its recorded grant source', () => {
    expect(rows.map(r => [r.id, r.type, r.status])).toEqual([
      ['lead:l1', 'lead', 'pending'],
      ['tx:t2', 'transfer', 'awaiting_payment'],
      ['tx:t1', 'paid', 'completed'],
      ['access:a2', 'free', 'active'],
      ['access:a4', 'free', 'active'],
      ['access:a3', 'manual', 'expired'],
      ['access:a5', 'subscription', 'active'],
      ['access:a6', 'other', 'active'],
    ]);
  });
  it('carries order number, email and product for display', () => {
    expect(rows.find(r => r.id === 'tx:t1')).toMatchObject({ orderNumber: 1300, email: 'a@x.pl', productName: 'Kurs', amount: 9900, currency: 'pln', transactionId: 't1' });
    expect(rows.find(r => r.id === 'access:a2')!.email).toBe('free@x.pl');
  });
});

describe('pageOrders @J190', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, 0) - i * 60_000).toISOString();
  const all = Array.from({ length: 5 }, (_, i) => ({ id: `tx:${i}`, createdAt: at(i) }));

  it('cuts a page and points the cursor at the last row shown', () => {
    const { page, nextCursor } = pageOrders(all, 2);
    expect(page.map(r => r.id)).toEqual(['tx:0', 'tx:1']);
    expect(decodeOrdersCursor(nextCursor!)).toEqual({ createdAt: at(1), id: 'tx:1' });
  });
  it('has no cursor on the last page', () => {
    expect(pageOrders(all, 5).nextCursor).toBeNull();
  });
  it('keeps database microsecond order inside one millisecond', () => {
    const rows = [{ id: 'tx:a', createdAt: '2026-11-03T13:46:36.731001+00:00' }, { id: 'tx:b', createdAt: '2026-11-03T13:46:36.731075+00:00' }];
    const first = pageOrders([...rows].sort(compareOrders), 1);
    expect(first.page.map(r => r.id)).toEqual(['tx:b']);
    expect(isAfterCursor(rows[0], decodeOrdersCursor(first.nextCursor!))).toBe(true);
  });
  it('round-trips and rejects tampered cursors', () => {
    const cursor = encodeOrdersCursor({ createdAt: at(3), id: 'access:ab12' });
    expect(decodeOrdersCursor(cursor)).toEqual({ createdAt: at(3), id: 'access:ab12' });
    expect(decodeOrdersCursor('not-a-cursor')).toBeNull();
    expect(decodeOrdersCursor(Buffer.from('{"createdAt":"x","id":1}').toString('base64url'))).toBeNull();
  });
});
