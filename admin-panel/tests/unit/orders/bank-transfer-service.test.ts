import { beforeEach, describe, expect, it, vi } from 'vitest';
const trigger = vi.hoisted(() => vi.fn());
const fulfill = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/transfer-mail', () => ({ sendTransferAccessMail: vi.fn() }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger } }));
vi.mock('@/lib/services/fulfill-paid-order', () => ({ fulfillPaidOrder: fulfill }));
import { dispatchTransferEvent, fulfillTransfer, runTransferJob } from '@/lib/orders/bank-transfer-service';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import recorded from '../../fixtures/business-events/transfer-placed.json';
const id = '10000000-0000-4000-8000-000000000001';
const row = { id, product_id: 'product', customer_email: 'buyer@example.com', user_id: null, metadata: { access_on_placement: false }, net_total: 10000, tax_total: 2300, tax_snapshot_status: 'local', payment_provider: 'bank_transfer', status: 'awaiting_payment', order_number: 1001, amount: 12300,
  currency: 'PLN', payment_due_at: '2000-01-01T00:00:00Z', transfer_details: { holder: 'Example' }, order_details: { buyer: { type: 'organization' } } };
function client(results: Array<{ data?: unknown; error?: unknown }> = []) {
  const queries: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const from = vi.fn(() => {
    const q = Promise.resolve({ data: null, error: null, ...results.shift() });
    const methods: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ['select', 'update', 'eq', 'single', 'is', 'lt', 'limit', 'not', 'in', 'contains']) {
      methods[name] = vi.fn(() => q); Object.assign(q, { [name]: methods[name] });
    }
    queries.push(methods); return q;
  });
  const rpc = vi.fn(async (name: string) => ({ data: name === 'find_user_id_by_email' ? null : { success: true }, error: null }));
  return { db: { from, rpc } as unknown as SupabaseClient<Database>, from, rpc, queries };
}
beforeEach(() => { vi.clearAllMocks(); trigger.mockResolvedValue(undefined); fulfill.mockResolvedValue(undefined); });
describe('transfer recovery', () => {
  it('does not emit overdue after the payment has completed', async () => {
    const { db } = client([{ data: { ...row, status: 'completed' } }, { data: [] }, {}]);
    await dispatchTransferEvent(db, id, 'order.overdue');
    expect(trigger).not.toHaveBeenCalled();
  });
  it.each(['order.placed', 'order.cancelled', 'order.overdue'] as const)('dispatches %s with stable order identity and details', async event => {
    const { db } = client([{ data: { ...row, status: event === 'order.cancelled' ? 'cancelled' : 'awaiting_payment' } }, { data: [{ ...recorded.payload.data.lines[0], product_id: 'product', session_label: 'Workshop' }] }, {}]);
    await dispatchTransferEvent(db, id, event);
    expect(trigger).toHaveBeenCalledWith(event, expect.objectContaining({ order: expect.objectContaining({ orderId: id, amount: 12300 }),
      orderDetails: row.order_details, lines: [expect.objectContaining({ session_label: 'Workshop' })] }), db, ['product']);
  });
  it('marks notification only after a durable enqueue succeeds', async () => {
    const { db, queries } = client([{ data: row }, { data: [] }]); trigger.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(dispatchTransferEvent(db, id, 'order.placed')).rejects.toThrow();
    expect(queries.every(query => query.update.mock.calls.length === 0)).toBe(true);
  });
  it('does not enqueue an already notified event', async () => {
    const { db } = client([{ data: { ...row, order_overdue_notified_at: '2026-01-01' } }]);
    await dispatchTransferEvent(db, id, 'order.overdue'); expect(trigger).not.toHaveBeenCalled();
  });
  it('reuses offline fulfillment with the immutable saved amount', async () => {
    const { db } = client([{ data: { ...row, status: 'completed', product_id: 'p', customer_email: 'buyer@example.com' } }]);
    await fulfillTransfer(db, id);
    expect(fulfill).toHaveBeenCalledWith(expect.objectContaining({ provider: { kind: 'offline' }, transactionId: id, amount: 12300 }));
  });
  it('bounds pending recovery and includes a two minute age threshold', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-02-02T12:00:00Z'));
    try {
      const { db, queries } = client([{ data: [] }, { data: [] }, { data: [row] }, { data: { ...row, status: 'completed' } }]);
      expect(await runTransferJob(db, 'fulfillment-resume')).toEqual({ processed: 1, errors: 0 });
      expect(queries[2].lt).toHaveBeenCalledWith('updated_at', '2026-02-02T11:58:00.000Z');
      expect(queries[2].limit).toHaveBeenCalledWith(100);
    } finally { vi.useRealTimers(); }
  });
  it('keeps a failed recovery available for a later invocation', async () => {
    const { db } = client([{ data: [] }, { data: [] }, { data: [row] }, { error: { message: 'unavailable' } }]);
    expect(await runTransferJob(db, 'fulfillment-resume')).toEqual({ processed: 0, errors: 1 });
  });
  it('rejects amount mismatch before fulfillment', async () => {
    const { db, rpc } = client(); rpc.mockResolvedValueOnce({ data: { success: false }, error: null });
    expect((await operateTransfer(db, 'actor', id, { action: 'mark-paid', amount: 9300, paidAt: '2026-01-01T00:00:00Z' })).success).toBe(false);
    expect(fulfill).not.toHaveBeenCalled();
  });
  it('requires a cancellation reason', async () => {
    const { db, rpc } = client();
    expect((await operateTransfer(db, 'actor', id, { action: 'cancel', reason: '' })).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
