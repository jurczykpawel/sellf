import { describe, it, expect, vi } from 'vitest';
import { FakturowniaProvider, mapInvoice } from '@/lib/invoicing/fakturownia';
import type { InvoiceInput } from '@/lib/invoicing/provider';

export const input: InvoiceInput = {
  externalKey: 'instance:1001', currency: 'PLN', issuedAt: '2026-10-23', paidAt: '2026-10-23',
  seller: { name: 'Sklep', nip: '5250001003', street: 'Główna 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
  buyer: { name: 'Jan Nowak', email: 'jan@example.com', company: false },
  exemption: 'art. 113 ust. 1 ustawy o VAT',
  lines: [{ name: 'Warsztat', quantity: 5, total: 745, tax: 'zw', net: false }],
};
describe('Fakturownia documented mapping', () => {
  it('maps person, exemption, five units and paid online invoice', () => {
    expect(mapInvoice(input)).toMatchObject({ buyer_name: 'Jan Nowak', buyer_company: false, status: 'paid', paid_date: '2026-10-23', exempt_tax_kind: 'Zwolnienie ze względu na nieprzekroczenie limitu obrotu (art. 113 ust 1 i 9 ustawy o VAT)', oid_unique: 'yes', positions: [{ quantity: 5, total_price_gross: 745, tax: 'zw' }] });
  });
  it('uses the documented KSeF exemption choice while retaining seller text', () => {
    expect(mapInvoice(input)).toMatchObject({ exempt_tax_kind: 'Zwolnienie ze względu na nieprzekroczenie limitu obrotu (art. 113 ust 1 i 9 ustawy o VAT)', description: input.exemption });
  });
  it('maps organization and a separate recipient with tax number', () => {
    expect(mapInvoice({ ...input, buyer: { name: 'Gmina', nip: '5250001003', company: true }, recipient: { name: 'Szkoła', nip: '5260250995', street: 'Szkolna 2', company: true } })).toMatchObject({ buyer_tax_no: '5250001003', recipients: [{ name: 'Szkoła', tax_no: '5260250995', street: 'Szkolna 2', company: true }] });
  });
  it('maps unpaid transfer with exact 14-day deadline and discounted net bump', () => {
    const result = mapInvoice({ ...input, paidAt: undefined, dueAt: '2026-11-06', lines: [...input.lines, { name: 'Bump', quantity: 1, total: 9, tax: 23, net: true }] });
    expect(result).toMatchObject({ status: 'issued', payment_to: '2026-11-06', payment_type: 'transfer', positions: [{ total_price_gross: 745 }, { total_price_net: 9, tax: 23 }] });
    expect(result).not.toHaveProperty('paid_date');
  });
  it('finds exact oid, requests all periods and ignores unrelated records', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: 123, number: 'FV/1', token: 'public-token', oid: input.externalKey }]));
    const provider = new FakturowniaProvider('example.fakturownia.pl', 'secret', fetcher);
    expect(await provider.findByExternalKey(input.externalKey)).toMatchObject({ success: true, id: '123', number: 'FV/1', viewUrl: 'https://example.fakturownia.pl/invoice/public-token' });
    expect(fetcher.mock.calls[0][0]).toContain('oid=instance%3A1001');
    expect(fetcher.mock.calls[0][0]).toContain('period=all');
    fetcher.mockResolvedValueOnce(Response.json([{ id: 124, number: 'FV/2', token: 'other', oid: 'unrelated' }]));
    expect(await provider.findByExternalKey(input.externalKey)).toBeNull();
  });
  it('issues documented JSON and sanitizes provider errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: 123, number: 'FV/1', token: 'public-token' })).mockResolvedValueOnce(Response.json({ error: 'secret jan@example.com' }, { status: 422 }));
    const provider = new FakturowniaProvider('example.fakturownia.pl', 'secret', fetcher);
    expect(await provider.issue(input)).toMatchObject({ success: true, number: 'FV/1' });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ api_token: 'secret', invoice: { oid: input.externalKey } });
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(await provider.issue(input)).toEqual({ success: false, error: 'Fakturownia HTTP 422' });
  });
  it('does not return arbitrary provider messages from a successful malformed response', async () => {
    const provider = new FakturowniaProvider('example.fakturownia.pl', 'secret', vi.fn().mockResolvedValue(Response.json({ failure: 'secret jan@example.com' })));
    expect(await provider.issue(input)).toEqual({ success: false, error: 'Invalid Fakturownia response' });
  });
  it('updates an issued transfer invoice to paid through PUT', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 123, number: 'FV/1', token: 'public-token' }));
    const provider = new FakturowniaProvider('example.fakturownia.pl', 'secret', fetcher);
    expect((await provider.markPaid('123', '2026-11-01')).success).toBe(true);
    expect(fetcher.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ invoice: { status: 'paid', paid_date: '2026-11-01' } });
  });
  it.each(['http://localhost' , 'other.example.com', 'https://a.fakturownia.pl/x', 'a.fakturownia.pl.evil.com'])('rejects unsupported domain %s', async domain => {
    const fetcher = vi.fn();
    const provider = new FakturowniaProvider(domain, 'secret', fetcher);
    expect(await provider.issue(input)).toMatchObject({ success: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
