import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The standard checkout sends the invoice section as one `invoice` object. The server
 * re-runs the same validation as the browser, writes the buyer (order + Stripe metadata) and,
 * when the shop collects it, the different invoice recipient. Stripe and Supabase are mocked.
 *
 * @see src/lib/checkout/invoice-section.ts
 */

const SESSION_ID = 'cs_test_invoice1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ADDRESS = { company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa' };

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  productRead: vi.fn(),
  sessionsRetrieve: vi.fn(),
  sessionsUpdate: vi.fn(),
  recipientEnabled: vi.fn(),
  saveRecipient: vi.fn(),
  applyIdentity: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.adminRpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.productRead }) }) }) })),
}));
vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  checkRateLimitForIdentifier: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/security/checkout-binding', () => ({ verifyCheckoutBinding: vi.fn(() => true) }));
vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => ({
    checkout: { sessions: { retrieve: mocks.sessionsRetrieve, update: mocks.sessionsUpdate } },
    paymentIntents: { retrieve: vi.fn(), update: vi.fn() },
  })),
}));
vi.mock('@/lib/stripe/checkout-config', () => ({ getCheckoutConfig: vi.fn().mockResolvedValue({ tax_mode: 'stripe_tax', collect_terms_of_service: false }) }));
vi.mock('@/lib/stripe/buyer-tax-identity', () => ({ applyBuyerTaxIdentityToCustomer: mocks.applyIdentity }));
vi.mock('@/lib/checkout/invoice-recipient-setting', () => ({ readInvoiceRecipientEnabled: mocks.recipientEnabled }));
vi.mock('@/lib/payment/order-recipient', async original => ({ ...await original<typeof import('@/lib/payment/order-recipient')>(), saveOrderRecipient: mocks.saveRecipient }));

import { POST } from '@/app/api/update-payment-metadata/route';

function request(invoice: unknown, extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/update-payment-metadata', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({
      clientSecret: `${SESSION_ID}_secret_abc`, bindingToken: 'binding', productId: PRODUCT_ID,
      fullName: 'Jan Kowalski', country: 'PL', invoice,
      // Legacy flat fields are ignored once the section is sent.
      needsInvoice: false, nip: '9999999999', companyName: 'IGNORED',
      ...extra,
    }),
  });
}
const buyerArg = () => mocks.adminRpc.mock.calls.find(([name]) => name === 'set_payment_order_buyer')?.[1].p_buyer;
const metadataArg = () => mocks.sessionsUpdate.mock.calls[0]?.[1].metadata;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SITE_URL', 'http://localhost:3000');
  mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', mode: 'payment', metadata: { product_id: PRODUCT_ID }, customer: 'cus_1' });
  mocks.adminRpc.mockResolvedValue({ data: 1, error: null });
  mocks.productRead.mockResolvedValue({ data: { checkout_profile: null, currency: 'PLN' }, error: null });
  mocks.recipientEnabled.mockResolvedValue(false);
  mocks.saveRecipient.mockResolvedValue({ ok: true });
});

describe('POST /api/update-payment-metadata — invoice section @J620', () => {
  it('a person without an invoice: no company data reaches the order or Stripe', async () => {
    const res = await POST(request({ want: false, mode: 'tax_id', buyer: { tax_id: '', country: 'PL', ...ADDRESS }, recipient: null }, { country: 'DE' }));
    expect(res.status).toBe(200);
    expect(buyerArg()).toMatchObject({ type: 'person', needs_invoice: false, nip: '', company_name: '', address: '', city: '', postal_code: '', country: 'DE' });
    expect(metadataArg()).toMatchObject({ needs_invoice: 'false', nip: '', company_name: '', country: 'DE' });
    expect(mocks.saveRecipient).not.toHaveBeenCalled();
  });

  it('a Polish company: normalized NIP, country from the number, Stripe tax identity', async () => {
    const res = await POST(request({ want: true, mode: 'tax_id', buyer: { tax_id: 'PL 118-169-72-28', country: 'DE', ...ADDRESS }, recipient: null }));
    expect(res.status).toBe(200);
    expect(buyerArg()).toMatchObject({ type: 'organization', needs_invoice: true, nip: '1181697228', company_name: ADDRESS.company_name, address: ADDRESS.address, postal_code: '00-001', city: 'Warszawa', country: 'PL' });
    expect(metadataArg()).toMatchObject({ needs_invoice: 'true', nip: '1181697228', company_name: ADDRESS.company_name, country: 'PL' });
    expect(mocks.applyIdentity).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ country: 'PL', taxId: '1181697228', address: ADDRESS.address }) }));
  });

  it('an EU company keeps its VAT number with the prefix', async () => {
    await POST(request({ want: true, mode: 'tax_id', buyer: { tax_id: 'DE123456789', country: 'PL', company_name: 'Muster GmbH', address: 'Hauptstr. 1', postal_code: '10115', city: 'Berlin' }, recipient: null }));
    expect(buyerArg()).toMatchObject({ needs_invoice: true, nip: 'DE123456789', country: 'DE', company_name: 'Muster GmbH' });
  });

  it('an organization without a NIP still asks for an invoice', async () => {
    await POST(request({ want: true, mode: 'manual', buyer: { tax_id: '', country: 'PL', ...ADDRESS }, recipient: null }));
    expect(buyerArg()).toMatchObject({ type: 'organization', needs_invoice: true, nip: '', company_name: ADDRESS.company_name, country: 'PL' });
    expect(metadataArg()).toMatchObject({ needs_invoice: 'true', nip: '' });
  });

  it('a company outside the EU, entered by hand', async () => {
    await POST(request({ want: true, mode: 'manual', buyer: { tax_id: 'EIN 12-3456789', country: 'US', company_name: 'Acme Inc.', address: '1 Main St', postal_code: '10001', city: 'New York' }, recipient: null }));
    expect(buyerArg()).toMatchObject({ needs_invoice: true, nip: 'EIN 12-3456789', country: 'US' });
  });

  it('invalid data: 422 with field errors, nothing saved, Stripe untouched', async () => {
    const res = await POST(request({ want: true, mode: 'tax_id', buyer: { tax_id: '1234567890', country: 'PL', ...ADDRESS, city: '' }, recipient: null }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ success: false, errors: [{ field: 'invoice.tax_id', code: 'nip_checksum' }, { field: 'invoice.city', code: 'required' }] });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });

  it('a malformed section is rejected', async () => {
    const res = await POST(request({ want: 'yes' }));
    expect(res.status).toBe(422);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/update-payment-metadata — different invoice recipient @J621', () => {
  const recipient = { tax_id: '5260250995', company_name: 'Szkoła Podstawowa nr 1', address: 'ul. Szkolna 1', postal_code: '11-111', city: 'Przykładowo' };
  const buyer = { tax_id: '1181697228', country: 'PL', ...ADDRESS };

  it('is refused while the shop setting is off', async () => {
    const res = await POST(request({ want: true, mode: 'tax_id', buyer, recipient }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: 'recipient', code: 'recipient_disabled' }] });
    expect(mocks.saveRecipient).not.toHaveBeenCalled();
  });

  it('is stored with the order when the shop collects it', async () => {
    mocks.recipientEnabled.mockResolvedValue(true);
    const res = await POST(request({ want: true, mode: 'tax_id', buyer, recipient }));
    expect(res.status).toBe(200);
    expect(mocks.saveRecipient).toHaveBeenCalledWith(expect.anything(), { session_id: SESSION_ID }, {
      v: 1, differs: true, company_name: 'Szkoła Podstawowa nr 1', nip: '5260250995', address: 'ul. Szkolna 1', postal_code: '11-111', city: 'Przykładowo', country: 'PL', tax_id_type: 'pl_nip', tax_id_country: 'PL',
    });
  });

  it('records "same as buyer" when the shop collects it and the buyer did not add one', async () => {
    mocks.recipientEnabled.mockResolvedValue(true);
    await POST(request({ want: true, mode: 'tax_id', buyer, recipient: null }));
    expect(mocks.saveRecipient).toHaveBeenCalledWith(expect.anything(), { session_id: SESSION_ID }, { v: 1, differs: false });
  });

  it('a failed recipient save stops the payment', async () => {
    mocks.recipientEnabled.mockResolvedValue(true);
    mocks.saveRecipient.mockResolvedValue({ ok: false });
    const res = await POST(request({ want: true, mode: 'tax_id', buyer, recipient }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'details_not_saved' });
  });
});

describe('POST /api/update-payment-metadata — one rule set for the standard checkout', () => {
  function flatRequest(fields: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/update-payment-metadata', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ clientSecret: `${SESSION_ID}_secret_abc`, bindingToken: 'binding', productId: PRODUCT_ID, fullName: 'Jan Kowalski', ...fields }),
    });
  }

  it('flat fields cannot bypass the invoice rules: a company without its address is refused', async () => {
    const res = await POST(flatRequest({ needsInvoice: true, nip: '1181697228', country: 'PL', companyName: '', address: '', postalCode: '', city: '' }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual(expect.arrayContaining([{ field: 'invoice.company_name', code: 'required' }, { field: 'invoice.city', code: 'required' }]));
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });

  it('complete flat company data goes through the same validation and is stored as an organization', async () => {
    const res = await POST(flatRequest({ needsInvoice: true, nip: 'PL 118-169-72-28', country: 'PL', companyName: ADDRESS.company_name, address: ADDRESS.address, postalCode: ADDRESS.postal_code, city: ADDRESS.city }));
    expect(res.status).toBe(200);
    expect(buyerArg()).toMatchObject({ type: 'organization', needs_invoice: true, nip: '1181697228', country: 'PL', company_name: ADDRESS.company_name });
  });

  it('flat fields without an invoice: a person', async () => {
    const res = await POST(flatRequest({ needsInvoice: false, country: 'DE' }));
    expect(res.status).toBe(200);
    expect(buyerArg()).toMatchObject({ type: 'person', needs_invoice: false, nip: '', company_name: '', country: 'DE' });
  });

  it('a long non-EU tax id is stored whole, never cut', async () => {
    const taxId = '1234567890123456789012345';
    const res = await POST(request({ want: true, mode: 'manual', buyer: { tax_id: taxId, country: 'US', company_name: 'Acme Inc.', address: '1 Main St', postal_code: '10001', city: 'New York' }, recipient: null }));
    expect(res.status).toBe(200);
    expect(buyerArg()).toMatchObject({ nip: taxId });
    expect(metadataArg()).toMatchObject({ nip: taxId });
  });

  it('a subscription cannot take a different recipient: refused, nothing silently dropped', async () => {
    mocks.recipientEnabled.mockResolvedValue(true);
    mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', mode: 'subscription', metadata: { product_id: PRODUCT_ID }, customer: 'cus_1' });
    const recipient = { tax_id: '5260250995', company_name: 'Szkoła Podstawowa nr 1', address: 'ul. Szkolna 1', postal_code: '11-111', city: 'Przykładowo' };
    const res = await POST(request({ want: true, mode: 'tax_id', buyer: { tax_id: '1181697228', country: 'PL', ...ADDRESS }, recipient }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: 'recipient', code: 'recipient_disabled' }] });
    expect(mocks.saveRecipient).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
});
