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
  upsert: vi.fn(async()=>({error:null})),
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
  createAdminClient: vi.fn(() => ({ rpc: mocks.adminRpc, from: () => ({ upsert:mocks.upsert, update: (value: unknown) => ({ match: () => mocks.customUpdate(value) }), select: () => ({ eq: () => ({ single: mocks.productRead }) }) }) })),
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

  it('refuses control characters and over-long text with field errors instead of storing a cut value', async () => {
    const res = await POST(makeRequest(SESSION_ID, { companyName: `  Acme\u0000\u0007  ${'x'.repeat(250)}` }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([{ field: 'invoice.company_name', code: 'too_long' }]);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
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


/** Every personal key the profile path removes from Stripe metadata (an empty value deletes it). */
const CLEARED_PERSONAL_METADATA = Object.fromEntries([
  'first_name', 'last_name', 'full_name', 'email', 'nip', 'tax_id', 'company_name',
  'address', 'city', 'postal_code', 'country', 'phone', 'buyer', 'recipient',
  'participants', 'participant_emails',
].map(key => [key, '']));

describe('profile order details', () => {
  const profile = { v: 1, modules: [{ id: 'buyer', types: ['person'] }, { id: 'quantity', min: 1, max: 5, mode: 'checkout' }] };
  const moduleValues = { buyer: { type: 'person', first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' }, quantity: 2 };
  beforeEach(() => { mocks.productRead.mockResolvedValue({ data: { checkout_profile: profile, currency: 'PLN' }, error: null }); });
  it.each([SESSION_ID, PI_ID])('stores modules in one RPC before updating %s without personal metadata', async id => {
    const res = await POST(makeRequest(id, { moduleValues }));
    expect(res.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.objectContaining({ p_product_id: PRODUCT_ID, p_quantity: 2, p_details: expect.objectContaining({ buyer: expect.objectContaining({ type: 'person', v: 1 }), quantity: { v: 1, value: 2 } }) }));
    const update = id === SESSION_ID ? mocks.sessionsUpdate : mocks.piUpdate;
    expect(update).toHaveBeenCalledWith(id, { metadata: CLEARED_PERSONAL_METADATA });
    expect(mocks.adminRpc.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });
  it('clears personal metadata and never resends the technical (cart) fields it read (W219c)', async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: { valid: true, id: 'coupon1' }, error: null });
    mocks.sessionsRetrieve.mockResolvedValue({ status: 'open', metadata: { product_id: PRODUCT_ID, bump_product_ids: 'bump1,bump2', has_coupon: 'true', coupon_id: 'coupon1', coupon_code: 'SAVED', product_type: 'one_time', checkout_binding: 'binding', has_bump: 'true', bump_count: '2', tax_id: '5252248481', nip: '5252248481', email: 'person@example.com', first_name: 'Jan' } });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues }));
    expect(res.status).toBe(200);
    // Stripe merges metadata, so the technical fields stay; resending a copy could roll back a newer cart.
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION_ID, { metadata: CLEARED_PERSONAL_METADATA });
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
  it('returns field errors when the merged order details exceed the stored limit', async () => {
    mocks.adminRpc.mockResolvedValue({ error: { code: '54000', message: 'details_too_large' }, data: null });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: 'moduleValues', code: 'details_too_large' }] });
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it.each(['22023', '23514'])('does not read other database refusals (%s) as a size problem', async code => {
    mocks.adminRpc.mockResolvedValue({ error: { code }, data: null });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues }));
    expect(res.status).toBe(500);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('refuses order details over the stored limit before the first write, so 422 leaves nothing saved', async () => {
    // 100 participants valid for the modules, 100-character multi-byte names, long e-mails.
    const bigProfile = { v: 1, modules: [{ id: 'buyer', types: ['person'] }, { id: 'quantity', min: 1, max: 100, mode: 'checkout' }, { id: 'participants', required: true, prefill_from_buyer: false }] };
    mocks.productRead.mockResolvedValue({ data: { checkout_profile: bigProfile, currency: 'PLN', custom_checkout_fields: [] }, error: null });
    const name = '漢'.repeat(100);
    const participants = Array.from({ length: 100 }, (_, i) => ({ first_name: name, last_name: name, email: `${'u'.repeat(60)}${i}@${'d'.repeat(60)}.${'e'.repeat(60)}.example.com` }));
    expect(Buffer.byteLength(JSON.stringify(participants))).toBeGreaterThan(65536);
    // The database measures the merged JSON and refuses it inside the one transaction.
    mocks.adminRpc.mockResolvedValue({ error: { code: '54000', message: 'details_too_large' }, data: null });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues: { ...moduleValues, quantity: 100, participants } }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: 'moduleValues', code: 'details_too_large' }] });
    expect(mocks.customUpdate).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
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
    // One transaction: custom fields ride in the same RPC as the merged details.
    expect(mocks.customUpdate).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.objectContaining({
      p_custom_field_values: { note: 'Workshop' }, p_session_id: SESSION_ID, p_quantity: 1,
    }));
  });
  it('an over-limit merged result saves neither the custom fields nor the details', async () => {
    mocks.adminRpc.mockResolvedValue({ error: { code: '54000', message: 'details_too_large' }, data: null });
    const res = await POST(makeRequest(SESSION_ID, { moduleValues, customFieldValues: { note: 'Workshop' } }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: 'moduleValues', code: 'details_too_large' }] });
    expect(mocks.customUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
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
  // The second tab learns the code is gone (used in the first tab) by a stable code,
  // so it can show a specific message and re-price instead of "could not save your details".
  it.each([
    { data: { valid: false, error: 'You have already used this code' }, error: null },
    { data: { valid: false, error: 'Code usage limit reached' }, error: null },
    { data: { valid: true, id: 'another-coupon' }, error: null },
  ])('stops confirmation with coupon_unavailable when the code is no longer available @J310', async (result) => {
    mocks.adminRpc.mockResolvedValue(result);
    const res = await POST(makeRequest(SESSION_ID, { email: 'buyer@example.com' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'coupon_unavailable' });
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('stops confirmation without blaming the code when the check itself fails', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const res = await POST(makeRequest(SESSION_ID, { email: 'buyer@example.com' }));
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty('code');
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
    mocks.productRead.mockResolvedValue({ data: { currency: 'PLN', checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'] }, { id: 'recipient', for: ['organization'] }] } }, error: null });
    const party = { company_name: 'Company', address: 'Street 1', city: 'Berlin', postal_code: '10115' };
    const res = await POST(makeRequest(SESSION_ID, { moduleValues: {
      buyer: { ...party, type: 'organization', country: 'DE', nip: 'DE123456789' },
      recipient: { ...party, city: 'Warszawa', postal_code: '00-001', differs: true, nip: '5260250995' },
    } }));
    expect(res.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.objectContaining({ p_details: expect.objectContaining({ buyer: expect.objectContaining({ nip: 'DE123456789' }), recipient: expect.objectContaining({ nip: '5260250995', country: 'PL' }) }) }));
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

describe('optional VIES check of an EU buyer', () => {
  it('stores the VIES result next to the number when the seller enabled it, without blocking', async () => {
    vi.stubEnv('SELLF_VIES_CHECK_ENABLED', 'true');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ isValid: false, userError: 'MS_UNAVAILABLE' }), { status: 200 }));
    try {
      mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', metadata: { product_id: PRODUCT_ID }, customer: 'cus_profile' });
      mocks.productRead.mockResolvedValue({ data: { currency: 'EUR', checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'] }] } }, error: null });
      const res = await POST(makeRequest(SESSION_ID, { moduleValues: { buyer: { type: 'organization', company_name: 'GmbH', address: 'Str 1', city: 'Berlin', postal_code: '10115', country: 'DE', nip: '123456789' } } }));
      expect(res.status).toBe(200);
      expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_details', expect.objectContaining({ p_details: expect.objectContaining({ buyer: expect.objectContaining({ nip: 'DE123456789', tax_id_type: 'eu_vat', tax_id_country: 'DE', tax_id_vies: 'unavailable' }) }) }));
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe('legacy invoice form: tax id validated by the company country on the server', () => {
  it.each([['PL', '1234567890', 'nip_checksum'], ['DE', 'DE12345', 'eu_vat_format'], ['US', '<script>', 'invalid_tax_id']])('rejects %s %s with the invoice section code %s', async (country, nip, code) => {
    mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', metadata: { product_id: PRODUCT_ID } });
    const res = await POST(makeRequest(SESSION_ID, { nip, country, needsInvoice: true, companyName: 'Firma' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ success: false, errors: [{ field: 'invoice.tax_id', code }] });
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  });
  it('accepts a German VAT number entered without its prefix and stores it normalized', async () => {
    mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', metadata: { product_id: PRODUCT_ID } });
    const res = await POST(makeRequest(SESSION_ID, { nip: '123456789', country: 'DE', needsInvoice: true, companyName: 'GmbH' }));
    expect(res.status).toBe(200);
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION_ID, { metadata: expect.objectContaining({ nip: 'DE123456789', country: 'DE' }) });
  });
});

it.each(['pl', 'en'])('saves submitted language %s on legacy and profile checkout objects', async locale => {
  for (const id of [SESSION_ID, PI_ID]) {
    expect((await POST(makeRequest(id, { locale }))).status).toBe(200);
    const update = id === SESSION_ID ? mocks.sessionsUpdate : mocks.piUpdate;
    expect(update).toHaveBeenLastCalledWith(id, { metadata: expect.objectContaining({ locale }) });
    mocks.productRead.mockResolvedValue({ data: { checkout_profile: { v: 1, modules: [] }, currency: 'PLN' }, error: null });
    expect((await POST(makeRequest(id, { locale, moduleValues: {} }))).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith(id, { metadata: expect.objectContaining({ locale }) });
    mocks.productRead.mockResolvedValue({ data: { checkout_profile: null }, error: null });
  }
});

it('returns an actionable expired session code before saving buyer data', async () => {
  mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'expired', metadata: { product_id: PRODUCT_ID } });
  const response = await POST(makeRequest(SESSION_ID));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ success: false, code: 'checkout_session_expired', error: expect.any(String) });
  expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
  expect(mocks.adminRpc).not.toHaveBeenCalled();
});

it('refuses a legacy full name beyond the stored limit without updating buyer details', async () => {
  const res = await POST(makeRequest(SESSION_ID, { fullName: 'R'.repeat(200) + 'Ż' }));
  expect(res.status).toBe(400);
  expect(mocks.adminRpc).not.toHaveBeenCalled();
  expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
});
it('stores a legacy name at the boundary including its final Polish letter', async () => {
  const fullName = 'R'.repeat(199) + 'Ż';
  expect((await POST(makeRequest(SESSION_ID, { fullName }))).status).toBe(200);
  expect(mocks.adminRpc).toHaveBeenCalledWith('set_payment_order_buyer', expect.objectContaining({ p_buyer: expect.objectContaining({ full_name: fullName }) }));
});
it('uses configured profile names independently of an unused legacy name', async () => {
  mocks.productRead.mockResolvedValue({ data: { checkout_profile: { v: 1, modules: [] }, currency: 'PLN' }, error: null });
  expect((await POST(makeRequest(SESSION_ID, { moduleValues: {}, fullName: 'R'.repeat(201) }))).status).toBe(200);
});

it.each([SESSION_ID,PI_ID])('stores subscription fields before confirming %s',async id=>{
  mocks.sessionsRetrieve.mockResolvedValue({id:SESSION_ID,status:'open',mode:'subscription',amount_total:1100,currency:'pln',metadata:{product_id:PRODUCT_ID},customer:null});
  mocks.piRetrieve.mockResolvedValue({id:PI_ID,status:'requires_confirmation',amount:1100,currency:'pln',metadata:{product_id:PRODUCT_ID,product_type:'subscription',subscription_id:'sub_1'},customer:null});
  mocks.productRead.mockResolvedValue({data:{custom_checkout_fields:[{id:'department',type:'text',label:'Department',required:true,max_length:100}]},error:null});
  const response=await POST(makeRequest(id,{email:'buyer@example.com',customFieldValues:{department:'Training'}}));
  expect(response.status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({reference:id===PI_ID?'sub_1':SESSION_ID,stripe_object_id:id,product_id:PRODUCT_ID,custom_field_values:{department:'Training'}}),{onConflict:'reference'});
});

it.each([SESSION_ID, PI_ID])('clears an optional subscription answer before confirming %s', async id => {
  mocks.sessionsRetrieve.mockResolvedValue({id:SESSION_ID,status:'open',mode:'subscription',metadata:{product_id:PRODUCT_ID},customer:null});
  mocks.piRetrieve.mockResolvedValue({id:PI_ID,status:'requires_payment_method',metadata:{product_id:PRODUCT_ID,product_type:'subscription',subscription_id:'sub_1'},customer:null});
  mocks.productRead.mockResolvedValue({data:{custom_checkout_fields:[{id:'department',type:'text',label:'Department',required:false,max_length:100}]},error:null});
  expect((await POST(makeRequest(id,{customFieldValues:{department:'Training'}}))).status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({custom_field_values:{department:'Training'}}),{onConflict:'reference'});
  mocks.upsert.mockClear();
  expect((await POST(makeRequest(id,{customFieldValues:{department:''}}))).status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({custom_field_values:{}}),{onConflict:'reference'});
});
