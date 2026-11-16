/** W223a: the recipient lands next to the buyer on the pending order only. @see src/lib/payment/order-recipient.ts */
import { describe, expect, it, vi } from 'vitest';
import { saveOrderRecipient, toStoredRecipient } from '@/lib/payment/order-recipient';

function admin(row: unknown, readError: unknown = null) {
  const calls: { update?: unknown; eqs: unknown[][]; match?: unknown } = { eqs: [] };
  const chain = {
    select: () => chain,
    match: (m: unknown) => { calls.match = m; return chain; },
    eq: (...args: unknown[]) => { calls.eqs.push(args); return chain; },
    maybeSingle: async () => ({ data: row, error: readError }),
    update: (value: unknown) => { calls.update = value; return { eq: (...a: unknown[]) => { calls.eqs.push(a); return { eq: async (...b: unknown[]) => { calls.eqs.push(b); return { error: null }; } }; } }; },
  };
  return { db: { from: vi.fn(() => chain) } as never, calls };
}

describe('saveOrderRecipient', () => {
  const recipient = toStoredRecipient({ company_name: 'Szkoła', nip: '5260250995', address: 'Szkolna 1', postal_code: '11-111', city: 'X', country: 'PL', tax_id_type: 'pl_nip', tax_id_country: 'PL' });

  it('merges the recipient into the pending order details, keeping the buyer', async () => {
    const { db, calls } = admin({ id: 'tx1', order_details: { buyer: { v: 1, nip: '1181697228' } } });
    expect(await saveOrderRecipient(db, { session_id: 'cs_1' }, recipient)).toEqual({ ok: true });
    expect(calls.match).toEqual({ session_id: 'cs_1' });
    expect(calls.update).toMatchObject({ order_details: { buyer: { v: 1, nip: '1181697228' }, recipient: { v: 1, differs: true, nip: '5260250995' } } });
    expect(calls.eqs).toContainEqual(['status', 'pending']);
    expect(calls.eqs).toContainEqual(['id', 'tx1']);
  });

  it('without a pending row there is nothing to write', async () => {
    const { db, calls } = admin(null);
    expect(await saveOrderRecipient(db, { session_id: 'cs_1' }, toStoredRecipient(null))).toEqual({ ok: true });
    expect(calls.update).toBeUndefined();
  });

  it('a read error is reported', async () => {
    const { db } = admin(null, { message: 'boom' });
    expect(await saveOrderRecipient(db, { session_id: 'cs_1' }, recipient)).toEqual({ ok: false });
  });
});
