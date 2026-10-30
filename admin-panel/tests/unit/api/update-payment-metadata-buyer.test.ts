import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/update-payment-metadata persists the buyer details on the pending
 * payment_transactions row before the payment can be confirmed.
 * Stripe, Supabase and rate limiting are mocked; the route logic runs for real.
 */

const SESSION_ID = 'cs_test_buyer1';
const PI_ID = 'pi_buyer1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  customUpdate: vi.fn(async () => ({ error: null })),
  productRead: vi.fn(),
  sessionsRetrieve: vi.fn(),
  sessionsUpdate: vi.fn(),
  piRetrieve: vi.fn(),
  piUpdate: vi.fn(),
  user: null as null | { id: string; email: string },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.adminRpc, from: () => ({ update: (value: unknown) => ({ match: () => mocks.customUpdate(value) }), select: () => ({ eq: () => ({ single: mocks.productRead }) }) }) })),
}));
vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  checkRateLimitForIdentifier: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/security/checkout-binding', () => ({ verifyCheckoutBinding: vi.fn(() => true) }));
vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => ({
    checkout: { sessions: { retrieve: mocks.sessionsRetrieve, update: mocks.sessionsUpdate } },
    paymentIntents: { retrieve: mocks.piRetrieve, update: mocks.piUpdate },
  })),
}));
vi.mock('@/lib/stripe/checkout-config', () => ({
  getCheckoutConfig: vi.fn().mockResolvedValue({ tax_mode: 'local' }),
}));
vi.mock('@/lib/stripe/buyer-tax-identity', () => ({ applyBuyerTaxIdentityToCustomer: vi.fn() }));

vi.mock('@/lib/checkout-modules/registry', async original => {
  const actual = await original<typeof import('@/lib/checkout-modules/registry')>();
  return { ...actual, validateModuleValues: vi.fn(actual.validateModuleValues) };
});
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { applyBuyerTaxIdentityToCustomer } from '@/lib/stripe/buyer-tax-identity';
import { POST } from '@/app/api/update-payment-metadata/route';

function makeRequest(objectId: string, extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/update-payment-metadata', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({
      clientSecret: `${objectId}_secret_abc`,
      bindingToken: 'binding',
      productId: PRODUCT_ID,
      fullName: 'Jan Kowalski',
      termsAccepted: true,
      needsInvoice: true,
      nip: '5252248481',
      companyName: 'Firma Sp. z o.o.',
      address: 'Prosta 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      ...extra,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.user = null;
  vi.mocked(getCheckoutConfig).mockResolvedValue({ tax_mode: 'local', collect_terms_of_service: false } as Awaited<ReturnType<typeof getCheckoutConfig>>);
  vi.stubEnv('SITE_URL', 'http://localhost:3000');
  mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', metadata: { product_id: PRODUCT_ID }, customer: null });
  mocks.piRetrieve.mockResolvedValue({ id: PI_ID, status: 'requires_payment_method', metadata: { product_id: PRODUCT_ID }, customer: null });
  mocks.adminRpc.mockResolvedValue({ data: 1, error: null });
  mocks.productRead.mockResolvedValue({ data: { checkout_profile: null }, error: null });
});

describe('POST /api/update-payment-metadata — buyer details on the pending row', () => {
  it('stores order_details.buyer for a checkout session', async () => {
    const res = await POST(makeRequest(SESSION_ID));

    expect(res.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.adminRpc.mock.calls[0];
    expect(name).toBe('set_payment_order_buyer');
    expect(args).toMatchObject({ p_session_id: SESSION_ID, p_only_if_missing: false });
    expect(args.p_payment_intent_id).toBeUndefined();
    expect(args.p_buyer).toMatchObject({
      v: 1,
      first_name: 'Jan',
      last_name: 'Kowalski',
      full_name: 'Jan Kowalski',
      needs_invoice: true,
      nip: '5252248481',
      company_name: 'Firma Sp. z o.o.',
      address: 'Prosta 1',
      city: 'Warszawa',
      postal_code: '00-001',
      country: 'PL',
      terms_accepted: true,
      source: 'checkout',
    });
    expect(Number.isNaN(Date.parse(args.p_buyer.saved_at))).toBe(false);
  });

  it('stores order_details.buyer for a payment intent', async () => {
    const res = await POST(makeRequest(PI_ID));

    expect(res.status).toBe(200);
    const [name, args] = mocks.adminRpc.mock.calls[0];
    expect(name).toBe('set_payment_order_buyer');
    expect(args).toMatchObject({ p_payment_intent_id: PI_ID, p_only_if_missing: false });
    expect(args.p_session_id).toBeUndefined();
  });

  it('sanitizes values before storing them', async () => {
    await POST(makeRequest(SESSION_ID, { companyName: `  Acme\u0000\u0007  ${'x'.repeat(400)}` }));

    const company = mocks.adminRpc.mock.calls[0][1].p_buyer.company_name as string;
    expect(company.startsWith('Acme')).toBe(true);
    expect(company).not.toMatch(/[\u0000-\u001f]/);
    expect(company.length).toBeLessThanOrEqual(200);
  });

  it('answers 409 details_not_saved when no pending row matches', async () => {
    mocks.adminRpc.mockResolvedValue({ data: 0, error: null });

    const res = await POST(makeRequest(SESSION_ID));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'details_not_saved' });
  });

  it('answers 500 details_not_saved when the database call fails', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });

    const res = await POST(makeRequest(SESSION_ID));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, code: 'details_not_saved' });
  });

  it('answers 500 details_not_saved when the database call throws', async () => {
    mocks.adminRpc.mockRejectedValue(new Error('network down'));

    const res = await POST(makeRequest(SESSION_ID));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, code: 'details_not_saved' });
  });
});

describe('subscription buyer details', () => {
  it('accepts a subscription session without a pending payment row', async () => {
    mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', mode: 'subscription', metadata: { product_id: PRODUCT_ID }, customer: null });
    mocks.adminRpc.mockResolvedValue({ data: 0, error: null });
    expect((await POST(makeRequest(SESSION_ID))).status).toBe(200);
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION_ID, { metadata: expect.objectContaining({ full_name: 'Jan Kowalski', nip: '5252248481' }) });
  });
  it('accepts a marked subscription intent without a pending payment row', async () => {
    mocks.piRetrieve.mockResolvedValue({ id: PI_ID, status: 'requires_payment_method', metadata: { product_id: PRODUCT_ID, product_type: 'subscription', subscription_id: 'sub_1' }, customer: null });
    mocks.adminRpc.mockResolvedValue({ data: 0, error: null });
    expect((await POST(makeRequest(PI_ID))).status).toBe(200);
  });
  it.each([SESSION_ID, PI_ID])('retains the one-time gate for %s regardless of the request flag', async objectId => {
    mocks.adminRpc.mockResolvedValue({ data: 0, error: null });
    const res = await POST(makeRequest(objectId, { productType: 'subscription', subscriptionId: 'sub_1' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'details_not_saved' });
  });
});


describe('profile order details', () => {
  const profile = { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }, { id: 'quantity', min: 1, max: 5, mode: 'checkout' }] };
  const moduleValues = { buyer: { type: 'person', first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' }, quantity: 2 };
  beforeEach(() => { mocks.productRead.mockResolvedValue({ data: { checkout_profile: profile, currency: 'PLN' }, error: null }); });
  it.each([SESSION_ID, PI_ID])('stores modules in one RPC before updating %s without personal metadata', async id => {
    const res = await POST(makeRequest(id, { moduleValues }));
    expect(res.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.objectContaining({ p_product_id: PRODUCT_ID, p_quantity: 2, p_details: expect.objectContaining({ buyer: expect.objectContaining({ type: 'person', v: 1 }), quantity: { v: 1, value: 2 } }) }));
    const update = id === SESSION_ID ? mocks.sessionsUpdate : mocks.piUpdate;
    expect(update).toHaveBeenCalledWith(id, { metadata: { product_id: PRODUCT_ID } });
    expect(mocks.adminRpc.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });
  it('clears personal metadata and preserves all technical fields', async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: { valid: true, id: 'coupon1' }, error: null });
    mocks.sessionsRetrieve.mockResolvedValue({ status: 'open', metadata: { product_id: PRODUCT_ID, bump_product_ids: 'bump1,bump2', has_coupon: 'true', coupon_id: 'coupon1', coupon_code: 'SAVED', product_type: 'one_time', checkout_binding: 'binding', has_bump: 'true', bump_count: '2', tax_id: '5252248481', nip: '5252248481', email: 'person@example.com', first_name: 'Jan' } });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues }));
    expect(res.status).toBe(200);
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION_ID, { metadata: { product_id: PRODUCT_ID, bump_product_ids: 'bump1,bump2', has_coupon: 'true', coupon_id: 'coupon1', coupon_code: 'SAVED', product_type: 'one_time', checkout_binding: 'binding', has_bump: 'true', bump_count: '2', tax_id: '', nip: '', email: '', first_name: '' } });
  });
  it('requires all module values even when moduleValues was omitted', async () => {
    const res = await POST(makeRequest(SESSION_ID));
    expect(res.status).toBe(422);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
  it('returns field errors and never saves invalid module data', async () => {
    const res = await POST(makeRequest(SESSION_ID, { moduleValues: { ...moduleValues, buyer: { ...moduleValues.buyer, email: 'bad' } } }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ field: 'buyer.email' })]) });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it.each([0, -1])('returns 409 when the pending snapshot differs or no row matches (%s)', async rows => {
    mocks.adminRpc.mockResolvedValue({ data: rows, error: null });
    expect((await POST(makeRequest(SESSION_ID, { moduleValues }))).status).toBe(409);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('returns field errors when order details exceed the stored limit', async () => {
    mocks.adminRpc.mockResolvedValue({ error: { code: '22023' }, data: null });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: 'moduleValues', code: 'details_too_large' }] });
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('stops when order detail persistence fails', async () => {
    mocks.adminRpc.mockResolvedValue({ error: { code: 'XX000' }, data: null });
    expect((await POST(makeRequest(SESSION_ID, { moduleValues }))).status).toBe(500);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('rejects a Stripe product binding different from the signed request', async () => {
    mocks.sessionsRetrieve.mockResolvedValue({ status: 'open', metadata: { product_id: 'other' } });
    expect((await POST(makeRequest(SESSION_ID, { moduleValues }))).status).toBe(403);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});


describe('profile and custom fields together', () => {
  const moduleValues = { quantity: 1 };
  beforeEach(() => { mocks.productRead.mockResolvedValue({ data: {
    checkout_profile: { v: 1, modules: [{ id: 'quantity', mode: 'checkout', min: 1, max: 5 }] }, currency: 'PLN',
    custom_checkout_fields: [{ id: 'note', type: 'text', label: 'Note', required: true, max_length: 200 }],
  }, error: null }); });
  it('saves both module and required custom field values', async () => {
    const res = await POST(makeRequest(SESSION_ID, { moduleValues, customFieldValues: { note: 'Workshop' } }));
    expect(res.status).toBe(200);
    expect(mocks.customUpdate).toHaveBeenCalledWith({ custom_field_values: { note: 'Workshop' } });
    expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.anything());
  });
  it.each([{}, undefined])('rejects missing required custom values before module persistence: %s', async customFieldValues => {
    expect((await POST(makeRequest(SESSION_ID, { moduleValues, customFieldValues }))).status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
});


it.each(['pl', 'en'])('passes request locale %s into the module registry', async locale => {
  mocks.productRead.mockResolvedValue({ data: { checkout_profile: { v: 1, modules: [] }, currency: 'PLN' }, error: null });
  expect((await POST(makeRequest(SESSION_ID, { moduleValues: {}, locale }))).status).toBe(200);
  expect(validateModuleValues).toHaveBeenCalledWith(expect.anything(), {}, expect.objectContaining({ locale }));
});


describe('coupon reservation at submit', () => {
  beforeEach(() => {
    mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', mode: 'payment', customer: null,
      metadata: { product_id: PRODUCT_ID, coupon_id: 'coupon-1', coupon_code: 'NET30' } });
    mocks.productRead.mockResolvedValue({ data: { checkout_profile: null, currency: 'PLN' }, error: null });
    mocks.adminRpc.mockImplementation(async (name: string) => name === 'verify_coupon'
      ? { data: { valid: true, id: 'coupon-1' }, error: null } : { data: 1, error: null });
  });
  it('reserves a link coupon for the email first entered on the payment form', async () => {
    expect((await POST(makeRequest(SESSION_ID, { email: ' Buyer@example.com ' }))).status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith('verify_coupon', {
      code_param: 'NET30', product_id_param: PRODUCT_ID, customer_email_param: 'buyer@example.com', currency_param: 'PLN',
    });
  });
  it.each([
    { data: { valid: false, error: 'Code usage limit reached' }, error: null },
    { data: { valid: true, id: 'another-coupon' }, error: null },
    { data: null, error: { message: 'unavailable' } },
  ])('stops confirmation when reservation is unavailable', async (result) => {
    mocks.adminRpc.mockResolvedValue(result);
    expect((await POST(makeRequest(SESSION_ID, { email: 'buyer@example.com' }))).status).toBe(409);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('requires a valid buyer email for coupon reservation', async () => {
    expect((await POST(makeRequest(SESSION_ID, { email: 'invalid' }))).status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});


describe('profile tax identity routing', () => {
  it.each(['stripe_tax', 'local'] as const)('uses buyer rather than recipient in %s mode', async tax_mode => {
    vi.mocked(getCheckoutConfig).mockResolvedValueOnce({ tax_mode } as Awaited<ReturnType<typeof getCheckoutConfig>>);
    mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', metadata: { product_id: PRODUCT_ID }, customer: 'cus_profile' });
    mocks.productRead.mockResolvedValue({ data: { currency: 'PLN', checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false }, { id: 'recipient', for: ['organization'] }] } }, error: null });
    const party = { company_name: 'Company', address: 'Street 1', city: 'Berlin', postal_code: '10115' };
    const res = await POST(makeRequest(SESSION_ID, { moduleValues: {
      buyer: { ...party, type: 'organization', country: 'DE', nip: 'DE123456789' },
      recipient: { ...party, differs: true, country: 'FR', nip: 'FRAB123456789' },
    } }));
    expect(res.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.objectContaining({ p_details: expect.objectContaining({ buyer: expect.objectContaining({ nip: 'DE123456789' }), recipient: expect.objectContaining({ nip: 'FRAB123456789' }) }) }));
    if (tax_mode === 'stripe_tax') expect(applyBuyerTaxIdentityToCustomer).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_profile', identity: { country: 'DE', taxId: 'DE123456789', address: 'Street 1', city: 'Berlin', postalCode: '10115' } }));
    else expect(applyBuyerTaxIdentityToCustomer).not.toHaveBeenCalled();
  });
});

it.each([[true, false, 400], [false, false, 200], [true, true, 200], [false, true, 200]])
  ('enforces the shared consent rule online (collect=%s signedIn=%s)', async (collect, signedIn, expected) => {
    mocks.user = signedIn ? { id: 'signed-in-buyer', email: 'buyer@example.com' } : null;
    const session = await mocks.sessionsRetrieve(SESSION_ID);
    session.metadata.user_id = mocks.user?.id;
    vi.mocked(getCheckoutConfig).mockResolvedValue({ tax_mode: 'local', collect_terms_of_service: collect } as Awaited<ReturnType<typeof getCheckoutConfig>>);
    expect((await POST(makeRequest(SESSION_ID, { termsAccepted: undefined }))).status).toBe(expected);
  });
