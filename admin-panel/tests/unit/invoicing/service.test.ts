import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { runInvoiceAttempt, retryDelayMs } from '@/lib/invoicing/service';
import { buildInvoiceInput } from '@/lib/invoicing/input';
import type { InvoiceInput, InvoiceProvider } from '@/lib/invoicing/provider';
import type { InvoiceTransaction, InvoiceLine } from '@/lib/invoicing/input';

const input: InvoiceInput = { externalKey: 'instance:1001', currency: 'PLN', issuedAt: '2026-10-23', seller: { name: 'Sklep' }, buyer: { name: 'Jan' }, lines: [] };
const issued = { success: true, id: '123', number: 'FV/1', viewUrl: 'https://example.fakturownia.pl/invoice/test' };
function setup() {
  let busy = false, saved = false;
  const claim = vi.fn(async () => { if (busy) return false; busy = true; return true; });
  const finish = vi.fn(async () => { saved = true; busy = false; return true; });
  const provider: InvoiceProvider = { id: 'fakturownia', findByExternalKey: vi.fn(async () => null), issue: vi.fn(async () => issued) };
  return { claim, finish, provider, saved: () => saved };
}
describe('durable invoice attempts', () => {
  it('two concurrent calls claim once and issue once', async () => {
    const s = setup();
    await Promise.all([runInvoiceAttempt(s, input), runInvoiceAttempt(s, input)]);
    expect(s.provider.issue).toHaveBeenCalledTimes(1);
    expect(s.finish).toHaveBeenCalledWith(issued);
  });
  it('recovers invoice after issue succeeded but saving failed', async () => {
    const s = setup();
    s.finish.mockResolvedValueOnce(false);
    await runInvoiceAttempt(s, input);
    vi.mocked(s.provider.findByExternalKey).mockResolvedValueOnce(issued);
    await runInvoiceAttempt({ ...s, claim: async () => true }, input);
    expect(s.provider.issue).toHaveBeenCalledTimes(1);
  });
  it('does not issue when lookup fails and records generic failure', async () => {
    const s = setup();
    vi.mocked(s.provider.findByExternalKey).mockResolvedValue({ success: false, error: 'Fakturownia HTTP 429' });
    await runInvoiceAttempt(s, input);
    expect(s.provider.issue).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith({ success: false, error: 'Fakturownia HTTP 429' });
  });
  it('contains unexpected exceptions without customer data', async () => {
    const s = setup();
    vi.mocked(s.provider.issue).mockRejectedValueOnce(new Error('jan@example.com secret'));
    expect(await runInvoiceAttempt(s, input)).toMatchObject({ success: false, error: 'Invoice request failed' });
  });
  it('only reconciles after the fifth interrupted attempt', async () => {
    const s = setup();
    await runInvoiceAttempt({ ...s, canIssue: false }, input);
    expect(s.provider.issue).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith({ success: false, error: 'Invoice requires provider review' });
  });
  it('records a failure when order loading fails after claim', async () => {
    const s = setup();
    await runInvoiceAttempt(s, async () => { throw new Error('order unavailable'); });
    expect(s.provider.issue).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith({ success: false, error: 'Invoice request failed' });
  });
  it('uses exponential delay and caps at five attempts', () => {
    expect([1,2,3,4].map(retryDelayMs)).toEqual([60000,120000,240000,480000]);
    expect(retryDelayMs(5)).toBeNull();
  });
});
describe('immutable order mapping', () => {
  const tx: InvoiceTransaction = { order_number: 1001, status: 'completed', customer_email: 'jan@example.com', currency: 'PLN', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:05:00Z', order_details: { buyer: { v: 1, first_name: 'Jan', last_name: 'Nowak', type: 'person' } }, metadata: {} };
  const line: InvoiceLine = { product_name: 'Warsztat', quantity: 5, discounted_total: 450, total_price: 500, vat_rate: 23, vat_exempt: false, tax_behavior: 'exclusive', net_amount: 45000, tax_amount: 10350, session_starts_at: '2026-11-12T16:00:00Z', tier_label: 'Pakiet zespołu' };
  it('uses discounted net snapshot and date/tier and keeps bump separate', () => {
    const mapped = buildInvoiceInput(tx, [line, { ...line, product_name: 'Materiały', quantity: 1, discounted_total: 9, net_amount: 900, tax_amount: 207 }], { shop_name: 'Sklep' }, input.externalKey, '', '{product} {date} {tier}');
    expect(mapped.buyer.name).toBe('Jan Nowak');
    expect(mapped.lines).toHaveLength(2);
    expect(mapped.lines[0]).toMatchObject({ name: 'Warsztat 2026-11-12 Pakiet zespołu', quantity: 5, total: 450, net: true, tax: 23 });
    expect(mapped.lines[1].total).toBe(9);
  });
  it('uses inclusive gross snapshot and exemption', () => {
    expect(buildInvoiceInput(tx, [{ ...line, vat_exempt: true, tax_behavior: 'inclusive', net_amount: 45000, tax_amount: 0 }], { shop_name: 'Sklep' }, 'key', 'art. 113', '{product}').lines[0]).toMatchObject({ total: 450, tax: 'zw', net: false });
  });
  it('maps Stripe reverse charge to NP and provider annotation', () => {
    const mapped = buildInvoiceInput(tx, [{ ...line, taxability_reason: 'reverse_charge', vat_rate: 0, tax_amount: 0 }], { shop_name: 'Sklep' }, 'key', '', '{product}');
    expect(mapped).toMatchObject({ reverseCharge: true, lines: [{ tax: 'np' }] });
  });
  it('does not infer reverse charge from a zero local rate', () => {
    const mapped = buildInvoiceInput(tx, [{ ...line, vat_rate: 0, tax_amount: 0 }], { shop_name: 'Sklep' }, 'key', '', '{product}');
    expect(mapped.reverseCharge).not.toBe(true);
    expect(mapped.lines[0].tax).toBe(0);
  });
  it('keeps transfer deadline and no paid date', () => {
    const mapped = buildInvoiceInput({ ...tx, status: 'awaiting_payment', payment_due_at: '2026-11-06T10:00:00Z' }, [line], { shop_name: 'Sklep' }, 'key', '', '{product}');
    expect(mapped.dueAt).toBe('2026-11-06');
    expect(mapped.paidAt).toBeUndefined();
  });
});
