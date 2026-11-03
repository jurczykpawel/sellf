/** Unpaid transfer lifecycle as seen by the integrator (webhook payload), the buyer (mail) and the administrator. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const trigger = vi.hoisted(() => vi.fn());
const fulfill = vi.hoisted(() => vi.fn());
const magic = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger } }));
vi.mock('@/lib/services/fulfill-paid-order', () => ({ fulfillPaidOrder: fulfill }));
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: magic }));
import { dispatchTransferEvent, runTransferJob } from '@/lib/orders/bank-transfer-service';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import { sendOrderNotice } from '@/lib/orders/transfer-mail';
import { verifyTransferToken } from '@/lib/orders/transfer-token';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const id = '10000000-0000-4000-8000-000000000001';
const row = { id, product_id: 'product', customer_email: 'buyer@example.com', user_id: null, metadata: { access_on_placement: false, locale: 'pl' },
  net_total: 10000, tax_total: 2300, tax_snapshot_status: 'local', payment_provider: 'bank_transfer', status: 'awaiting_payment', order_number: 1001,
  amount: 12300, currency: 'PLN', payment_due_at: '2026-02-03T12:00:00.000Z', reminder_at: '2026-02-02T12:00:00.000Z', release_at: '2026-02-03T12:00:00.000Z',
  transfer_details: { holder: 'Example', account: 'PL61109010140000071219812874', title: 'Zamówienie 1001' }, order_details: { buyer: { type: 'organization' } },
  cancel_reason: null, transfer_declared_at: null, transfer_declared_note: null, invoice_hold_at: null, reopened_at: null };

type Result = { data?: unknown; error?: unknown };
function client(results: Result[] = [], rpcResult: (name: string, args: Record<string, unknown>) => Result = () => ({ data: { success: true } })) {
  const queries: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const from = vi.fn(() => {
    const q = Promise.resolve({ data: null, error: null, ...results.shift() });
    const methods: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ['select', 'update', 'eq', 'single', 'maybeSingle', 'is', 'lt', 'lte', 'limit', 'not', 'in', 'contains']) {
      methods[name] = vi.fn(() => q); Object.assign(q, { [name]: methods[name] });
    }
    queries.push(methods); return q;
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({ error: null, ...(name === 'find_user_id_by_email' ? { data: null } : rpcResult(name, args)) }));
  return { db: { from, rpc } as unknown as SupabaseClient<Database>, from, rpc, queries };
}
const payload = () => trigger.mock.calls[0][1] as { order: Record<string, unknown>; customer: Record<string, unknown> };

beforeEach(() => {
  vi.clearAllMocks(); vi.useRealTimers();
  trigger.mockResolvedValue(undefined); fulfill.mockResolvedValue(undefined); magic.mockResolvedValue({ ok: true });
  vi.stubEnv('CHECKOUT_BINDING_SECRET', 'test-binding-secret'); vi.stubEnv('SITE_URL', 'https://shop.example'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example');
});

describe('order.* contract for integrators', () => {
  it('reminder carries a working pay link, the reservation window and the buyer locale', async () => {
    const { db } = client([{ data: row }, { data: [] }, { data: [] }, {}]);
    await dispatchTransferEvent(db, id, 'order.payment_reminder');
    expect(trigger).toHaveBeenCalledWith('order.payment_reminder', expect.anything(), db, ['product']);
    const { order, customer } = payload();
    expect(customer).toMatchObject({ email: 'buyer@example.com', locale: 'pl' });
    expect(order).toMatchObject({ orderId: id, status: 'awaiting_payment', reservation: 'timed', reminderAt: row.reminder_at, releaseAt: row.release_at });
    const url = new URL(order.payUrl as string);
    expect(url.origin).toBe('https://shop.example');
    expect(url.pathname).toBe(`/pl/order/${id}/transfer`);
    expect(verifyTransferToken(url.searchParams.get('token') ?? undefined, id)).toBe(true);
    expect(Date.parse(order.payUrlExpiresAt as string)).toBeGreaterThan(Date.now() + 60 * 86400000);
  });
  it('does not remind about an order without a timer or no longer unpaid', async () => {
    for (const changed of [{ release_at: null }, { status: 'completed' }, { status: 'cancelled' }]) {
      const { db } = client([{ data: { ...row, ...changed } }]);
      await dispatchTransferEvent(db, id, 'order.payment_reminder');
    }
    expect(trigger).not.toHaveBeenCalled();
  });
  it('automatic cancellation is distinguishable from an administrator cancellation', async () => {
    const { db } = client([{ data: { ...row, status: 'cancelled', cancel_reason: 'payment_window_expired' } }, { data: [] }, { data: [] }, {}]);
    await dispatchTransferEvent(db, id, 'order.cancelled');
    expect(payload().order).toMatchObject({ status: 'cancelled', cancelReason: 'payment_window_expired', lateTransferPolicy: 'admin_decision' });
  });
  it('invoice hold is announced once with no expiry', async () => {
    const { db } = client([{ data: { ...row, release_at: null, reminder_at: null, invoice_hold_at: '2026-02-01T12:05:00.000Z' } }, { data: [] }, { data: [] }, {}]);
    await dispatchTransferEvent(db, id, 'order.invoice_issued');
    expect(payload().order).toMatchObject({ reservation: 'invoice', releaseAt: null, invoiceHoldAt: '2026-02-01T12:05:00.000Z' });
    const { db: unheld } = client([{ data: row }]);
    trigger.mockClear(); await dispatchTransferEvent(unheld, id, 'order.invoice_issued'); expect(trigger).not.toHaveBeenCalled();
  });
  it('declaration and reopening are announced only after they happened', async () => {
    const { db } = client([{ data: { ...row, transfer_declared_at: '2026-02-02T13:00:00.000Z', transfer_declared_note: 'Wysłane' } }, { data: [] }, { data: [] }, {}]);
    await dispatchTransferEvent(db, id, 'order.transfer_declared');
    expect(payload().order).toMatchObject({ transferDeclaredAt: '2026-02-02T13:00:00.000Z', transferDeclaredNote: 'Wysłane' });
    trigger.mockClear();
    const { db: none } = client([{ data: { ...row, status: 'completed' } }]);
    await dispatchTransferEvent(none, id, 'order.reopened'); expect(trigger).not.toHaveBeenCalled();
    const { db: reopened } = client([{ data: { ...row, status: 'completed', reopened_at: '2026-02-05T00:00:00.000Z' } }, { data: [] }, { data: [] }, {}]);
    await dispatchTransferEvent(reopened, id, 'order.reopened');
    expect(payload().order).toMatchObject({ status: 'completed', reopenedAt: '2026-02-05T00:00:00.000Z', previousStatus: 'cancelled' });
  });
});

describe('reservation job', () => {
  it('releases due orders with the job clock and announces cancellation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-02-03T12:00:00Z'));
    const released = { ...row, status: 'cancelled', cancel_reason: 'payment_window_expired' };
    const { db, rpc } = client([
      { data: [] },            // reminders due
      { data: [{ id }] },      // releases due
      { data: released }, { data: [] }, { data: [] }, {}, // order.cancelled dispatch
      { data: released }, { data: { slug: 'w', name: 'Warsztat' } }, {}, // cancellation mail
      { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, // recovery sweeps
    ], name => name === 'release_unpaid_transfer' ? { data: { success: true, released: true } } : { data: { success: true } });
    const result = await runTransferJob(db, 'transfer-reservations');
    expect(rpc).toHaveBeenCalledWith('release_unpaid_transfer', { p_id: id, p_now: '2026-02-03T12:00:00.000Z' });
    expect(trigger).toHaveBeenCalledWith('order.cancelled', expect.anything(), db, ['product']);
    expect(magic).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mail_kind: 'order_cancelled' }) }));
    expect(result.errors).toBe(0);
  });
});

describe('buyer mail', () => {
  it('reminder mail names the release time and the pay link even without access on placement', async () => {
    const { db, queries } = client([{ data: row }, { data: { slug: 'w', name: 'Warsztat' } }, {}]);
    await sendOrderNotice(db, id, 'reminder');
    const data = magic.mock.calls[0][0].data as Record<string, string>;
    expect(data.mail_kind).toBe('payment_reminder');
    expect(new URL(data.pay_url).pathname).toBe(`/pl/order/${id}/transfer`);
    expect(data.release_text).toContain('3 lutego 2026');
    expect(queries[2].update).toHaveBeenCalledWith({ reminder_mail_sent_at: expect.any(String) });
  });
  it('placed mail is sent for every transfer order', async () => {
    const { db } = client([{ data: { ...row, metadata: { access_on_placement: false, locale: 'en' } } }, { data: { slug: 'w', name: 'Workshop' } }, {}]);
    await sendOrderNotice(db, id, 'placed');
    expect(magic.mock.calls[0][0].data).toMatchObject({ mail_kind: 'transfer_placed', locale: 'en' });
  });
  it('a failed delivery stays pending for the next job', async () => {
    magic.mockResolvedValue({ ok: false, code: 'rate_limited' });
    const { db, queries } = client([{ data: row }, { data: { slug: 'w', name: 'Warsztat' } }]);
    await sendOrderNotice(db, id, 'reminder');
    expect(queries.some(q => q.update.mock.calls.length)).toBe(false);
  });
});

describe('administrator decisions', () => {
  it('a late transfer after cancellation needs an explicit acceptance with a reason', async () => {
    const { db, rpc } = client();
    expect((await operateTransfer(db, 'actor', id, { action: 'mark-paid', amount: 12300, paidAt: '2026-01-01T00:00:00Z', acceptCancelled: true })).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('accepting a cancelled order announces reopening before the purchase', async () => {
    const reopened = { ...row, status: 'completed', reopened_at: '2026-02-05T00:00:00.000Z' };
    const { db, rpc } = client([{ data: reopened }, { data: [] }, { data: [] }, {}, { data: reopened }],
      () => ({ data: { success: true, reopened: true, previous_status: 'cancelled' } }));
    const result = await operateTransfer(db, 'actor', id, { action: 'mark-paid', amount: 12300, paidAt: '2026-01-01T00:00:00Z', acceptCancelled: true, reason: 'Przelew po terminie' });
    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith('admin_bank_transfer_order', expect.objectContaining({ p_accept_cancelled: true, p_reason: 'Przelew po terminie' }));
    expect(trigger.mock.calls.map(c => c[0])).toEqual(['order.reopened']);
    expect(fulfill).toHaveBeenCalled();
  });
  it('an integrator can mark an externally issued invoice so the order no longer expires', async () => {
    const held = { ...row, release_at: null, invoice_hold_at: '2026-02-01T12:00:00.000Z' };
    const { db, rpc } = client([{ data: held }, { data: [] }, { data: [] }, {}]);
    expect((await operateTransfer(db, 'actor', id, { action: 'invoice-issued' })).success).toBe(true);
    expect(rpc).toHaveBeenCalledWith('admin_bank_transfer_order', expect.objectContaining({ p_action: 'invoice-issued' }));
    expect(trigger.mock.calls[0][0]).toBe('order.invoice_issued');
  });
});
