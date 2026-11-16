/**
 * W223b part 2 (i)+(ii): the checkout profile (online payment and bank transfer) uses the same
 * invoice rules and error codes as the standard checkout section: on the NIP path the number decides
 * the country, the manual path checks a chosen country, the address is always complete, and a
 * different recipient (an institution) always carries a Polish NIP (owner decision c, 16.11).
 *
 * @see src/lib/checkout/invoice-section.ts
 * @see src/lib/checkout-modules/buyer.ts
 * @see src/lib/checkout-modules/recipient.ts
 */
import { describe, expect, it } from 'vitest';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import { validateCheckoutModules } from '@/lib/checkout-modules/validate';

const profile = checkoutProfileSchema.parse({ v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'] }, { id: 'recipient', for: ['organization'] }] });
const ctx = { locale: 'pl', currency: 'PLN', quantity: 1 };
const address = { company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa' };
const org = (patch: Record<string, unknown>) => ({ type: 'organization', ...address, nip: '', country: 'PL', ...patch });
const run = (buyer: unknown, recipient: unknown = { differs: false }) => validateModuleValues(profile, { buyer, recipient }, ctx);
const codes = (result: ReturnType<typeof run>) => result.success ? [] : result.errors.map(e => `${e.field}:${e.code}`);

describe('profile buyer = invoice section rules @J623', () => {
  it('NIP path: the number decides the country, not the submitted country', () => {
    const result = run(org({ tax_id_mode: 'tax_id', nip: 'DE123456789', country: 'PL', company_name: 'Muster GmbH' }));
    expect(result.success && result.details.buyer).toMatchObject({ nip: 'DE123456789', country: 'DE', tax_id_type: 'eu_vat', tax_id_country: 'DE' });
  });

  it('NIP path without a number: the same "enter a NIP or choose no NIP" code', () => {
    expect(codes(run(org({ tax_id_mode: 'tax_id', nip: '' })))).toEqual(['buyer.nip:tax_id_required']);
  });

  it('the same tax id codes as the standard checkout', () => {
    expect(codes(run(org({ tax_id_mode: 'tax_id', nip: '123' })))).toEqual(['buyer.nip:nip_length']);
    expect(codes(run(org({ tax_id_mode: 'tax_id', nip: '1234567890' })))).toEqual(['buyer.nip:nip_checksum']);
    expect(codes(run(org({ nip: '1234567890' })))).toEqual(['buyer.nip:nip_checksum']);
    expect(codes(run(org({ tax_id_mode: 'tax_id', nip: 'XX123' })))).toEqual(['buyer.nip:unknown_prefix']);
  });

  it('the same address rules: every field required, no markup characters', () => {
    expect(codes(run(org({ city: '', address: 'ul. <b>Wzorcowa</b>' })))).toEqual(['buyer.address:invalid_text', 'buyer.city:required']);
  });

  it('manual path: an organization without a NIP and an EU company without a number are both allowed', () => {
    expect(run(org({ nip: '' })).success).toBe(true);
    expect(run(org({ nip: '', country: 'FR', city: 'Paris' })).success).toBe(true);
  });

  it('IE numbers with + or * pass, as in the standard checkout', () => {
    expect(run(org({ tax_id_mode: 'tax_id', nip: 'IE1+23456A', city: 'Dublin' })).success).toBe(true);
  });

  it('the path marker is not stored with the order', () => {
    const result = run(org({ tax_id_mode: 'tax_id', nip: '1181697228' }));
    expect(result.success && result.details.buyer).not.toHaveProperty('tax_id_mode');
  });
});

describe('profile recipient = an institution with a Polish NIP @J623', () => {
  const recipient = { differs: true, company_name: 'Szkoła Podstawowa nr 1', address: 'ul. Szkolna 1', postal_code: '11-111', city: 'Przykładowo' };

  it('stores a Polish NIP recipient in Poland', () => {
    const result = run(org({ nip: '1181697228', tax_id_mode: 'tax_id' }), { ...recipient, nip: '5260250995' });
    expect(result.success && result.details.recipient).toEqual({ v: 1, differs: true, company_name: 'Szkoła Podstawowa nr 1', nip: '5260250995', address: 'ul. Szkolna 1', postal_code: '11-111', city: 'Przykładowo', country: 'PL', tax_id_type: 'pl_nip', tax_id_country: 'PL' });
  });

  it('refuses a recipient without a NIP or with a foreign VAT number', () => {
    expect(codes(run(org({ nip: '1181697228' }), { ...recipient, nip: '' }))).toEqual(['recipient.nip:tax_id_required']);
    expect(codes(run(org({ nip: '1181697228' }), { ...recipient, nip: 'FRAB123456789', country: 'FR' }))).toEqual(['recipient.nip:nip_only']);
  });

  it('bank transfer runs the same gate', () => {
    const result = validateCheckoutModules(profile, { buyer: org({ nip: '1181697228', tax_id_mode: 'tax_id' }), recipient: { ...recipient, nip: 'DE123456789' } }, { locale: 'pl', currency: 'PLN', termsAccepted: true });
    expect(result.success ? [] : result.errors).toEqual([{ field: 'recipient.nip', code: 'nip_only' }]);
  });
});
