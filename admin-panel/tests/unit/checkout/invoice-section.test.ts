/**
 * The checkout invoice section. One field "NIP or EU VAT
 * number" decides the company country; the manual path covers buyers without a NIP and companies
 * outside the EU; the recipient (another institution) is a shop setting and always carries a NIP.
 * The same validation runs in the browser and on the server.
 *
 * @see src/lib/checkout/invoice-section.ts
 */
import { describe, expect, it } from 'vitest';
import { detectTaxId, validateInvoiceSection } from '@/lib/checkout/invoice-section';
import type { InvoiceSectionInput } from '@/lib/checkout/invoice-section';

const ADDRESS = { company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa' };
const section = (patch: Partial<InvoiceSectionInput> = {}): InvoiceSectionInput => ({
  want: true, mode: 'tax_id', buyer: { tax_id: '1181697228', country: 'PL', ...ADDRESS }, recipient: null, ...patch,
});
const codes = (result: ReturnType<typeof validateInvoiceSection>) => result.ok ? [] : result.errors.map(e => `${e.field}:${e.code}`);

describe('detectTaxId: the number decides the country', () => {
  it.each([
    ['1181697228', 'pl_nip', 'PL', '1181697228'],
    ['118-169-72-28', 'pl_nip', 'PL', '1181697228'],
    ['PL 1181697228', 'pl_nip', 'PL', '1181697228'],
    ['DE123456789', 'eu_vat', 'DE', 'DE123456789'],
    ['de 123 456 789', 'eu_vat', 'DE', 'DE123456789'],
    ['EL123456789', 'eu_vat', 'GR', 'EL123456789'],
    ['ATU12345678', 'eu_vat', 'AT', 'ATU12345678'],
  ])('%s → %s %s', (input, type, country, normalized) => {
    expect(detectTaxId(input)).toEqual({ status: 'valid', type, country, normalized });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
  ])('%j is empty', (input, status) => {
    expect(detectTaxId(input).status).toBe(status);
  });

  it.each([
    ['123456', 'nip_length'],
    ['12345678901', 'nip_length'],
    ['1234567890', 'nip_checksum'],
    ['US123456789', 'unknown_prefix'],
    ['GB123456789', 'unknown_prefix'],
    ['DE12345', 'eu_vat_format'],
    ['FR12', 'eu_vat_format'],
    ['abc-!', 'not_tax_id'],
  ])('%s is invalid with %s', (input, code) => {
    expect(detectTaxId(input)).toMatchObject({ status: 'invalid', code });
  });

  it('a recipient field accepts only a Polish NIP', () => {
    expect(detectTaxId('DE123456789', { allowEu: false })).toMatchObject({ status: 'invalid', code: 'nip_only' });
    expect(detectTaxId('1181697228', { allowEu: false })).toMatchObject({ status: 'valid', country: 'PL' });
  });
});

describe('validateInvoiceSection: what reaches the order', () => {
  it('a person without an invoice stores no company data', () => {
    const result = validateInvoiceSection(section({ want: false, buyer: { tax_id: '1234', country: 'PL', company_name: 'x', address: '', postal_code: '', city: '' } }), { recipientEnabled: false });
    expect(result).toEqual({ ok: true, buyer: null, recipient: null });
  });

  it('a Polish company: NIP normalized, country forced to PL from the number', () => {
    const result = validateInvoiceSection(section({ buyer: { tax_id: 'PL 118-169-72-28', country: 'DE', ...ADDRESS } }), { recipientEnabled: false });
    expect(result).toEqual({ ok: true, recipient: null, buyer: { ...ADDRESS, nip: '1181697228', country: 'PL', tax_id_type: 'pl_nip', tax_id_country: 'PL' } });
  });

  it('an EU company: VAT number with prefix, country from the prefix', () => {
    const result = validateInvoiceSection(section({ buyer: { tax_id: 'DE123456789', country: 'PL', company_name: 'Muster GmbH', address: 'Hauptstr. 1', postal_code: '10115', city: 'Berlin' } }), { recipientEnabled: false });
    expect(result).toMatchObject({ ok: true, buyer: { nip: 'DE123456789', country: 'DE', tax_id_type: 'eu_vat', tax_id_country: 'DE' } });
  });

  it('an organization without a NIP (manual, Poland): invoice without tax id', () => {
    const result = validateInvoiceSection(section({ mode: 'manual', buyer: { tax_id: '', country: 'PL', ...ADDRESS } }), { recipientEnabled: false });
    expect(result).toEqual({ ok: true, recipient: null, buyer: { ...ADDRESS, nip: '', country: 'PL' } });
  });

  it('a company outside the EU (manual): any optional tax number, chosen country', () => {
    const result = validateInvoiceSection(section({ mode: 'manual', buyer: { tax_id: 'EIN 12-3456789', country: 'US', company_name: 'Acme Inc.', address: '1 Main St', postal_code: '10001', city: 'New York' } }), { recipientEnabled: false });
    expect(result).toMatchObject({ ok: true, buyer: { nip: 'EIN 12-3456789', country: 'US', tax_id_type: 'other', tax_id_country: 'US' } });
  });

  it('the address is always required: country, name, street and number, postal code, city', () => {
    const result = validateInvoiceSection(section({ buyer: { tax_id: '1181697228', country: 'PL', company_name: ' ', address: '', postal_code: '', city: '' } }), { recipientEnabled: false });
    expect(codes(result)).toEqual(['invoice.company_name:required', 'invoice.address:required', 'invoice.postal_code:required', 'invoice.city:required']);
  });

  it('the NIP path needs a number; a bad number is reported on the field', () => {
    expect(codes(validateInvoiceSection(section({ buyer: { tax_id: '', country: 'PL', ...ADDRESS } }), { recipientEnabled: false }))).toEqual(['invoice.tax_id:tax_id_required']);
    expect(codes(validateInvoiceSection(section({ buyer: { tax_id: '1234567890', country: 'PL', ...ADDRESS } }), { recipientEnabled: false }))).toEqual(['invoice.tax_id:nip_checksum']);
    expect(codes(validateInvoiceSection(section({ buyer: { tax_id: 'US12', country: 'PL', ...ADDRESS } }), { recipientEnabled: false }))).toEqual(['invoice.tax_id:unknown_prefix']);
  });

  it('manual path: an EU country checks the VAT format, an unknown country code is rejected', () => {
    expect(codes(validateInvoiceSection(section({ mode: 'manual', buyer: { tax_id: 'DE12', country: 'DE', ...ADDRESS } }), { recipientEnabled: false }))).toEqual(['invoice.tax_id:eu_vat_format']);
    expect(codes(validateInvoiceSection(section({ mode: 'manual', buyer: { tax_id: '', country: 'XX', ...ADDRESS } }), { recipientEnabled: false }))).toEqual(['invoice.country:invalid_country']);
  });

  it('control characters and overlong text are rejected', () => {
    expect(codes(validateInvoiceSection(section({ buyer: { tax_id: '1181697228', country: 'PL', ...ADDRESS, city: 'War\u0000szawa' } }), { recipientEnabled: false }))).toEqual(['invoice.city:invalid_text']);
    expect(codes(validateInvoiceSection(section({ buyer: { tax_id: '1181697228', country: 'PL', ...ADDRESS, company_name: 'x'.repeat(201) } }), { recipientEnabled: false }))).toEqual(['invoice.company_name:too_long']);
  });

  it('a different recipient: only when the shop enabled it, always with a Polish NIP', () => {
    const recipient = { tax_id: '5260250995', company_name: 'Szkoła Podstawowa nr 1', address: 'ul. Szkolna 1', postal_code: '11-111', city: 'Przykładowo' };
    expect(codes(validateInvoiceSection(section({ recipient }), { recipientEnabled: false }))).toEqual(['recipient:recipient_disabled']);
    expect(validateInvoiceSection(section({ recipient }), { recipientEnabled: true })).toMatchObject({
      ok: true,
      recipient: { company_name: 'Szkoła Podstawowa nr 1', nip: '5260250995', country: 'PL', tax_id_type: 'pl_nip', tax_id_country: 'PL' },
    });
    expect(codes(validateInvoiceSection(section({ recipient: { ...recipient, tax_id: '' } }), { recipientEnabled: true }))).toEqual(['recipient.tax_id:tax_id_required']);
    expect(codes(validateInvoiceSection(section({ recipient: { ...recipient, tax_id: 'DE123456789' } }), { recipientEnabled: true }))).toEqual(['recipient.tax_id:nip_only']);
    expect(codes(validateInvoiceSection(section({ recipient: { ...recipient, city: '' } }), { recipientEnabled: true }))).toEqual(['recipient.city:required']);
  });

  it('a recipient without a company invoice is impossible', () => {
    const recipient = { tax_id: '5260250995', ...ADDRESS };
    expect(validateInvoiceSection(section({ want: false, recipient }), { recipientEnabled: true })).toEqual({ ok: true, buyer: null, recipient: null });
  });
});

describe('one source of truth for formats and limits', () => {
  it.each(['IE1+23456A', 'IE1*23456A'])('%s: characters are judged by the country pattern, as in classifyTaxId', input => {
    expect(detectTaxId(input)).toEqual({ status: 'valid', type: 'eu_vat', country: 'IE', normalized: input });
  });

  it('a plus sign in a Polish NIP is still not a NIP', () => {
    expect(detectTaxId('118+169728')).toEqual({ status: 'invalid', code: 'not_tax_id' });
  });

  it('one length limit: 40 characters accepted whole, 41 refused with a clear code', () => {
    const ok = 'A'.repeat(40);
    const okResult = validateInvoiceSection(section({ mode: 'manual', buyer: { tax_id: ok, country: 'US', ...ADDRESS } }), { recipientEnabled: false });
    expect(okResult.ok && okResult.buyer?.nip).toBe(ok);
    expect(codes(validateInvoiceSection(section({ mode: 'manual', buyer: { tax_id: 'A'.repeat(41), country: 'US', ...ADDRESS } }), { recipientEnabled: false }))).toEqual(['invoice.tax_id:tax_id_too_long']);
    expect(detectTaxId('1'.repeat(41))).toEqual({ status: 'invalid', code: 'tax_id_too_long' });
  });
});
