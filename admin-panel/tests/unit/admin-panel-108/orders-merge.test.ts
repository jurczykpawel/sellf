/** One orders list: paid, bank transfer, free, manual grants and leads. @see src/lib/orders/merge.ts */
import { describe, expect, it } from 'vitest';
import { mergeOrders } from '@/lib/orders/merge';

const products = new Map([
  ['p-paid', { name: 'Kurs', slug: 'kurs', price: 99 }],
  ['p-free', { name: 'Poradnik', slug: 'poradnik', price: 0 }],
]);

describe('mergeOrders @J160', () => {
  const rows = mergeOrders({
    transactions: [
      { id: 't1', order_number: 1300, customer_email: 'a@x.pl', user_id: 'u1', product_id: 'p-paid', amount: 9900, currency: 'pln', status: 'completed', payment_provider: 'stripe', created_at: '2026-11-01T10:00:00Z' },
      { id: 't2', order_number: 1301, customer_email: 'b@x.pl', user_id: null, product_id: 'p-paid', amount: 9900, currency: 'pln', status: 'awaiting_payment', payment_provider: 'bank_transfer', created_at: '2026-11-02T10:00:00Z' },
    ],
    accesses: [
      { id: 'a1', user_id: 'u1', product_id: 'p-paid', access_granted_at: '2026-11-01T10:00:05Z', access_expires_at: null, transfer_transaction_id: null },
      { id: 'a2', user_id: 'u2', product_id: 'p-free', access_granted_at: '2026-10-30T10:00:00Z', access_expires_at: null, transfer_transaction_id: null },
      { id: 'a3', user_id: 'u3', product_id: 'p-paid', access_granted_at: '2026-10-29T10:00:00Z', access_expires_at: '2026-10-30T00:00:00Z', transfer_transaction_id: null },
    ],
    leads: [{ id: 'l1', email: 'lead@x.pl', product_id: 'p-free', confirmed_at: null, created_at: '2026-11-03T08:00:00Z' }],
    products,
    emails: new Map([['u1', 'a@x.pl'], ['u2', 'free@x.pl'], ['u3', 'manual@x.pl']]),
    now: new Date('2026-11-03T12:00:00Z'),
  });

  it('classifies every source and drops accesses already covered by a payment', () => {
    expect(rows.map(r => [r.id, r.type, r.status])).toEqual([
      ['lead:l1', 'lead', 'pending'],
      ['tx:t2', 'transfer', 'awaiting_payment'],
      ['tx:t1', 'paid', 'completed'],
      ['access:a2', 'free', 'active'],
      ['access:a3', 'manual', 'expired'],
    ]);
  });
  it('carries order number, email and product for display', () => {
    const paid = rows.find(r => r.id === 'tx:t1')!;
    expect(paid).toMatchObject({ orderNumber: 1300, email: 'a@x.pl', productName: 'Kurs', amount: 9900, currency: 'pln', transactionId: 't1' });
    expect(rows.find(r => r.id === 'access:a2')!.email).toBe('free@x.pl');
  });
  it('filters by type and status', () => {
    const only = (type?: string, status?: string) => mergeOrders({ transactions: [], accesses: [], leads: [], products, emails: new Map(), type, status }).length;
    expect(only()).toBe(0);
    const filtered = mergeOrders({ transactions: [], accesses: [{ id: 'a2', user_id: 'u2', product_id: 'p-free', access_granted_at: '2026-10-30T10:00:00Z', access_expires_at: null, transfer_transaction_id: null }], leads: [{ id: 'l1', email: 'lead@x.pl', product_id: 'p-free', confirmed_at: '2026-11-03T09:00:00Z', created_at: '2026-11-03T08:00:00Z' }], products, emails: new Map(), type: 'lead', status: 'confirmed' });
    expect(filtered.map(r => r.id)).toEqual(['lead:l1']);
  });
});
