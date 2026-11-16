/**
 * W223a: one lookup adapter for company data in every checkout (owner 10.11: GUS now, VIES later).
 * @see src/lib/checkout/invoice-company-lookup.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canLookUpCompany, lookupInvoiceCompany } from '@/lib/checkout/invoice-company-lookup';

afterEach(() => vi.unstubAllGlobals());

function stubGus(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ status, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('lookupInvoiceCompany', () => {
  it('a Polish NIP asks GUS and maps the answer to separate address fields', async () => {
    const fetchMock = stubGus(200, { success: true, data: { nazwa: 'Przykładowa Sp. z o.o.', ulica: 'ul. Wzorcowa', nrNieruchomosci: '12', nrLokalu: '4', miejscowosc: 'Warszawa', kodPocztowy: '00-001', regon: '1', nip: '1181697228' } });
    const result = await lookupInvoiceCompany({ type: 'pl_nip', normalized: '1181697228' });
    expect(result).toEqual({ ok: true, source: 'gus', party: { company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa', country: 'PL' } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ nip: '1181697228' });
  });

  it.each([
    [404, { success: false, code: 'NOT_FOUND' }, 'not_found'],
    [200, { success: false, code: 'NOT_CONFIGURED' }, 'not_configured'],
    [429, { success: false }, 'rate_limit'],
    [500, { success: false }, 'unavailable'],
  ])('GUS %s → %s', async (status, body, code) => {
    stubGus(status, body);
    expect(await lookupInvoiceCompany({ type: 'pl_nip', normalized: '1181697228' })).toEqual({ ok: false, code });
  });

  it('an EU VAT number has no source yet and never calls the network', async () => {
    const fetchMock = stubGus(200, {});
    expect(await lookupInvoiceCompany({ type: 'eu_vat', normalized: 'DE123456789' })).toEqual({ ok: false, code: 'unsupported' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(canLookUpCompany('eu_vat')).toBe(false);
    expect(canLookUpCompany('pl_nip')).toBe(true);
  });
});
