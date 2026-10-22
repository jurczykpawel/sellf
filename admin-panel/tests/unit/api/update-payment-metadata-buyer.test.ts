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
  sessionsRetrieve: vi.fn(),
  sessionsUpdate: vi.fn(),
  piRetrieve: vi.fn(),
  piUpdate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.adminRpc })),
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
  vi.clearAllMocks();
  vi.stubEnv('SITE_URL', 'http://localhost:3000');
  mocks.sessionsRetrieve.mockResolvedValue({ id: SESSION_ID, status: 'open', metadata: { product_id: PRODUCT_ID }, customer: null });
  mocks.piRetrieve.mockResolvedValue({ id: PI_ID, status: 'requires_payment_method', metadata: { product_id: PRODUCT_ID }, customer: null });
  mocks.adminRpc.mockResolvedValue({ data: 1, error: null });
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
