/** Transfer invoices share the durable lifecycle with online payments. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ issue: vi.fn(), find: vi.fn(), markPaid: vi.fn(), invoices: new Map<string, { success: boolean; id: string; number: string; viewUrl: string; paid: boolean }>() }));
vi.mock('@/lib/invoicing/config', async original => ({ ...await original<typeof import('@/lib/invoicing/config')>(), configuredProvider: async () => ({
  id: 'fakturownia', issue: state.issue, findByExternalKey: state.find, markPaid: state.markPaid,
}) }));
import { createAdminClient } from '@/lib/supabase/admin';
import { issueInvoiceForTransaction, retryInvoices } from '@/lib/invoicing/service';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import type { InvoiceInput } from '@/lib/invoicing/provider';
const db = createAdminClient();
if (process.env.SUPABASE_URL !== 'http://127.0.0.1:55550') throw new Error('Requires allocated sellf-e1 database');
let productId: string, adminId: string, config: unknown, transfer: unknown;
const orders: string[] = [];
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
beforeAll(async () => {
  config = await checked(await db.from('invoicing_config').select('*').single());
  transfer = await checked(await db.from('bank_transfer_config').select('*').single());
  adminId = (await checked(await db.from('admin_users').select('user_id').limit(1).single())).user_id;
  await checked(await db.from('invoicing_config').update({ provider: 'fakturownia', domain: 'fixture.fakturownia.pl', mode: 'auto' }).eq('id', true).select());
  await checked(await db.rpc('save_bank_transfer_config', { p_actor: adminId, p_config: {
    bank_transfer_enabled: true, bank_account_holder: 'Test shop', bank_account_number: 'PL61109010140000071219812874',
    bank_name: '', bank_transfer_title_template: 'Order {order_number}', bank_transfer_due_days: 14,
    bank_transfer_grant_access_on_placement: false, bank_transfer_max_unpaid_per_email: 3,
  } }));
  productId = (await checked(await db.from('products').insert({ name: 'Transfer invoice test', slug: `transfer-invoice-${crypto.randomUUID()}`, price: 100, currency: 'PLN', is_active: true,
    checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] }] }, vat_exempt: true }).select('id').single())).id;
  state.find.mockImplementation(async (key: string) => state.invoices.get(key) ?? null);
  state.issue.mockImplementation(async (input: InvoiceInput) => {
    const result = { success: true, id: String(1000 + state.invoices.size), number: `FV/${state.invoices.size + 1}`, viewUrl: 'https://fixture.fakturownia.pl/invoice/test', paid: Boolean(input.paidAt) };
    state.invoices.set(input.externalKey, result); return result;
  });
  state.markPaid.mockResolvedValue({ success: true, paid: true });
});
afterAll(async () => {
  if (orders.length) { await db.from('invoices').delete().in('transaction_id', orders); await db.from('payment_transactions').delete().in('id', orders); }
  if (productId) await db.from('products').delete().eq('id', productId);
  if (config) await db.from('invoicing_config').upsert(config as never);
  if (transfer) await db.from('bank_transfer_config').upsert(transfer as never);
});
async function place() {
  const value = await checked(await db.rpc('bank_transfer_order', { p_order: { product_id: productId, currency: 'PLN', customer_email: 'transfer-invoice@example.com', order_details: {
    v: 1, buyer: { type: 'organization', company_name: 'Workshop', nip: '5260250274', address: 'Prosta 1', city: 'Warszawa', postal_code: '00-001', country: 'PL', terms_accepted: true },
  } }, p_lines: [{ product_id: productId, item_type: 'main_product', product_name: 'Transfer invoice test', quantity: 1, unit_price: 100, total_price: 100, discounted_total: 100, currency: 'PLN', vat_exempt: true }] }));
  const result = value as { transaction_id: string; dueAt: string; order_number: number }; orders.push(result.transaction_id); return result;
}
describe('transfer invoice lifecycle on PostgreSQL', () => {
  it('issues unpaid for fourteen days, marks the same invoice paid with receipt date, and remains idempotent', async () => {
    const order = await place();
    expect(await issueInvoiceForTransaction(order.transaction_id, { client: db })).toMatchObject({ success: true });
    const input = state.issue.mock.calls.find(([input]) => input.externalKey.endsWith(`:${order.order_number}`))![0] as InvoiceInput;
    expect(input.dueAt).toBe(order.dueAt.slice(0, 10)); expect(input.paidAt).toBeUndefined();
    const tx = await checked(await db.from('payment_transactions').select('created_at').eq('id', order.transaction_id).single());
    expect(Date.parse(order.dueAt) - Date.parse(tx.created_at)).toBe(14 * 86400000);
    const invoice = await checked(await db.from('invoices').select('*').eq('transaction_id', order.transaction_id).single());
    expect(invoice).toMatchObject({ status: 'issued', payment_synced: false });
    expect((await operateTransfer(db, adminId, order.transaction_id, { action: 'mark-paid', amount: 10000, paidAt: '2026-01-01T00:00:00Z' })).success).toBe(true);
    await retryInvoices();
    expect(state.markPaid).toHaveBeenCalledWith(invoice.provider_invoice_id, '2026-01-01');
    expect(await checked(await db.from('invoices').select('id,payment_synced').eq('transaction_id', order.transaction_id).single())).toEqual({ id: invoice.id, payment_synced: true });
    await issueInvoiceForTransaction(order.transaction_id, { client: db }); await retryInvoices();
    expect(state.issue.mock.calls.filter(([i]) => i.externalKey === input.externalKey)).toHaveLength(1);
    expect((await db.from('invoices').select('*', { count: 'exact', head: true }).eq('transaction_id', order.transaction_id)).count).toBe(1);
  });
  it('recovers a placement whose invoice callback did not run', async () => {
    const order = await place(); await retryInvoices();
    expect(await checked(await db.from('invoices').select('status').eq('transaction_id', order.transaction_id).single())).toEqual({ status: 'issued' });
    expect(state.issue.mock.calls.find(([input]) => input.externalKey.endsWith(`:${order.order_number}`))).toBeTruthy();
  });
  it('keeps a cancelled issued invoice for manual correction', async () => {
    const order = await place(); await issueInvoiceForTransaction(order.transaction_id, { client: db });
    expect((await operateTransfer(db, adminId, order.transaction_id, { action: 'cancel', reason: 'Customer request' })).success).toBe(true);
    expect(await checked(await db.from('payment_transactions').select('status').eq('id', order.transaction_id).single())).toEqual({ status: 'cancelled' });
    expect(await checked(await db.from('invoices').select('status').eq('transaction_id', order.transaction_id).single())).toEqual({ status: 'issued' });
  });
});
