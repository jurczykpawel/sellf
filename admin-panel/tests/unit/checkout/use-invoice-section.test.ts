// @vitest-environment happy-dom
/**
 * W223a: behaviour of the checkout invoice section (accepted mockup v3).
 * @see src/hooks/useInvoiceSection.ts
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('@/lib/checkout/invoice-company-lookup', () => ({ lookupInvoiceCompany: lookup, canLookUpCompany: (type: string) => type === 'pl_nip' }));

import { useInvoiceSection } from '@/hooks/useInvoiceSection';

const FOUND = { ok: true, source: 'gus', party: { company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa', country: 'PL' } };

beforeEach(() => { lookup.mockReset(); lookup.mockResolvedValue(FOUND); });

describe('useInvoiceSection', () => {
  it('starts as a purchase without a company invoice', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    expect(result.current.want).toBe(false);
    expect(result.current.toSubmit()).toMatchObject({ want: false, recipient: null });
    expect(result.current.validate()).toBe(true);
  });

  it('a complete Polish NIP fetches the company on its own and shows the company card', async () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => result.current.setWant(true));
    act(() => result.current.setTaxId('buyer', '118-169-72-28'));
    expect(result.current.buyer.lookup).toBe('loading');
    await waitFor(() => expect(result.current.buyer.lookup).toBe('found'));
    expect(lookup).toHaveBeenCalledWith({ type: 'pl_nip', normalized: '1181697228' });
    expect(result.current.buyer.fields).toMatchObject({ companyName: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postalCode: '00-001', city: 'Warszawa', country: 'PL' });
    expect(result.current.view('buyer')).toEqual({ card: true, address: false, countryLocked: true });
    act(() => result.current.startEditing('buyer'));
    expect(result.current.view('buyer')).toEqual({ card: false, address: true, countryLocked: true });
    expect(result.current.validate()).toBe(true);
    expect(result.current.toSubmit()).toEqual({ want: true, mode: 'tax_id', buyer: { tax_id: '118-169-72-28', company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa', country: 'PL' }, recipient: null });
  });

  it('an EU VAT number locks the country and asks for the address by hand', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', 'DE123456789'); });
    expect(lookup).not.toHaveBeenCalled();
    expect(result.current.buyer.lookup).toBe('unsupported');
    expect(result.current.buyer.fields.country).toBe('DE');
    expect(result.current.view('buyer')).toEqual({ card: false, address: true, countryLocked: true });
  });

  it('GUS without the company: the same address block, Poland locked', async () => {
    lookup.mockResolvedValue({ ok: false, code: 'not_found' });
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '1181697228'); });
    await waitFor(() => expect(result.current.buyer.lookup).toBe('not_found'));
    expect(result.current.view('buyer')).toEqual({ card: false, address: true, countryLocked: true });
  });

  it('a late GUS answer for an old number never overwrites the new one', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    lookup.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    lookup.mockResolvedValueOnce({ ok: false, code: 'not_found' });
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '1181697228'); });
    act(() => result.current.setTaxId('buyer', '5260250995'));
    await waitFor(() => expect(result.current.buyer.lookup).toBe('not_found'));
    await act(async () => { resolveFirst(FOUND); });
    expect(result.current.buyer.lookup).toBe('not_found');
    expect(result.current.buyer.fields.companyName).toBe('');
  });

  it('a wrong number shows its error when the field is left, not while typing', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '123'); });
    expect(result.current.errors['invoice.tax_id']).toBeUndefined();
    act(() => result.current.blurTaxId('buyer'));
    expect(result.current.errors['invoice.tax_id']).toBe('nip_length');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('submitting an incomplete section marks every missing field', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => result.current.setWant(true));
    let ok = true;
    act(() => { ok = result.current.validate(); });
    expect(ok).toBe(false);
    expect(result.current.errors).toMatchObject({ 'invoice.tax_id': 'tax_id_required', 'invoice.company_name': 'required', 'invoice.city': 'required' });
  });

  it('the manual path: chosen country, optional tax number, back to the NIP path keeps the address', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setMode('manual'); });
    expect(result.current.view('buyer')).toEqual({ card: false, address: true, countryLocked: false });
    act(() => {
      result.current.setField('buyer', 'country', 'US');
      result.current.setField('buyer', 'companyName', 'Acme Inc.');
      result.current.setField('buyer', 'address', '1 Main St');
      result.current.setField('buyer', 'postalCode', '10001');
      result.current.setField('buyer', 'city', 'New York');
    });
    expect(result.current.validate()).toBe(true);
    expect(result.current.toSubmit()).toMatchObject({ mode: 'manual', buyer: { country: 'US', company_name: 'Acme Inc.', tax_id: '' } });
    act(() => result.current.setMode('tax_id'));
    expect(result.current.buyer.fields.companyName).toBe('Acme Inc.');
  });

  it('the recipient exists only when the shop collects it and needs its own NIP', async () => {
    const off = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { off.result.current.setWant(true); off.result.current.setWantRecipient(true); });
    expect(off.result.current.toSubmit().recipient).toBeNull();

    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: true }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '1181697228'); });
    await waitFor(() => expect(result.current.buyer.lookup).toBe('found'));
    act(() => result.current.setWantRecipient(true));
    let ok = true;
    act(() => { ok = result.current.validate(); });
    expect(ok).toBe(false);
    expect(result.current.errors['recipient.tax_id']).toBe('tax_id_required');
    act(() => result.current.setTaxId('recipient', 'DE123456789'));
    act(() => result.current.blurTaxId('recipient'));
    expect(result.current.errors['recipient.tax_id']).toBe('nip_only');
    act(() => result.current.setTaxId('recipient', '5260250995'));
    await waitFor(() => expect(result.current.recipient.lookup).toBe('found'));
    expect(result.current.validate()).toBe(true);
    expect(result.current.toSubmit().recipient).toMatchObject({ tax_id: '5260250995', company_name: 'Przykładowa Sp. z o.o.' });
  });

  it('server field errors land on the fields', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => result.current.applyServerErrors([{ field: 'invoice.city', code: 'required' }, { field: 'other', code: 'x' }]));
    expect(result.current.errors).toEqual({ 'invoice.city': 'required' });
  });

  it('a saved profile with a company opens the section filled in', () => {
    const { result, rerender } = renderHook(({ prefill }) => useInvoiceSection({ recipientEnabled: false, prefill }), {
      initialProps: { prefill: null as null | { taxId: string; companyName: string; address: string; postalCode: string; city: string; country: string } },
    });
    rerender({ prefill: { taxId: '1181697228', companyName: 'Moja Firma', address: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' } });
    expect(result.current.want).toBe(true);
    expect(result.current.mode).toBe('tax_id');
    expect(result.current.view('buyer')).toEqual({ card: false, address: true, countryLocked: true });
    expect(lookup).not.toHaveBeenCalled();
    rerender({ prefill: { taxId: '', companyName: 'Fundacja', address: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' } });
    expect(result.current.buyer.fields.companyName).toBe('Moja Firma');
  });
  it('a late GUS answer never overwrites data typed after switching to the manual path (W223ar #3)', async () => {
    let resolveLate: (value: unknown) => void = () => {};
    lookup.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }));
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '1181697228'); });
    expect(result.current.buyer.lookup).toBe('loading');
    act(() => result.current.setMode('manual'));
    act(() => { result.current.setField('buyer', 'country', 'US'); result.current.setField('buyer', 'companyName', 'MANUAL COMPANY'); });
    await act(async () => { resolveLate({ ...FOUND, party: { ...FOUND.party, company_name: 'LATE GUS COMPANY' } }); });
    expect(result.current.mode).toBe('manual');
    expect(result.current.buyer.fields).toMatchObject({ companyName: 'MANUAL COMPANY', country: 'US' });
  });

  it('a late GUS answer never overwrites a field the buyer edited meanwhile (W223ar #3)', async () => {
    let resolveLate: (value: unknown) => void = () => {};
    lookup.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }));
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '1181697228'); });
    act(() => result.current.setField('buyer', 'companyName', 'TYPED'));
    await act(async () => { resolveLate(FOUND); });
    expect(result.current.buyer.fields.companyName).toBe('TYPED');
  });

  it('the "no NIP" path drops the hidden number, so it cannot block the purchase (W223ar #4)', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setTaxId('buyer', '123'); });
    act(() => result.current.setMode('manual'));
    act(() => {
      result.current.setField('buyer', 'companyName', 'Fundacja Przykład');
      result.current.setField('buyer', 'address', 'ul. Prosta 1');
      result.current.setField('buyer', 'postalCode', '00-001');
      result.current.setField('buyer', 'city', 'Warszawa');
    });
    let ok = false;
    act(() => { ok = result.current.validate(); });
    expect(ok).toBe(true);
    expect(result.current.toSubmit().buyer.tax_id).toBe('');
  });

  it('manual path back to Poland: the number field disappears and its value is not sent (W223ar #4)', () => {
    const { result } = renderHook(() => useInvoiceSection({ recipientEnabled: false }));
    act(() => { result.current.setWant(true); result.current.setMode('manual'); });
    act(() => { result.current.setField('buyer', 'country', 'US'); result.current.setField('buyer', 'taxId', 'EIN-1'); });
    act(() => result.current.setField('buyer', 'country', 'PL'));
    expect(result.current.toSubmit().buyer.tax_id).toBe('');
  });

});
