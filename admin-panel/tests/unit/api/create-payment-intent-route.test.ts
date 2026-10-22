import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Behavioural tests for POST /api/create-payment-intent (one-time path).
 * Supabase, Stripe and config lookups are mocked; pricing runs for real.
 */

const PRODUCT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'course',
  name: 'Course',
  description: null,
  price: 100,
  currency: 'PLN',
  is_active: true,
  product_type: 'one_time',
  allow_custom_price: false,
  custom_price_min: null,
  vat_rate: 23,
  price_includes_vat: true,
  vat_exempt: false,
  custom_checkout_fields: [],
  checkout_template: null,
  issue_license_on_purchase: false,
};

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  userRpc: vi.fn(),
  adminRpc: vi.fn(),
  adminInserts: [] as Array<{ table: string; value: unknown }>,
  getOrCreateStripeCustomer: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  sessionsExpire: vi.fn(),
  verifyBinding: vi.fn(() => false),
  pendingInsertError: null as { message: string } | null,
  productOverride: {} as Record<string, unknown>,
}));

function adminQuery(table: string) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  let inserting = false;
  Object.assign(q, {
    select: self,
    eq: self,
    in: self,
    limit: self,
    single: async () =>
      table === 'products'
        ? { data: { ...PRODUCT, ...mocks.productOverride }, error: null }
        : table === 'payment_method_config'
          ? { data: null, error: null }
          : { data: null, error: { code: 'PGRST116' } },
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (value: unknown) => {
      mocks.adminInserts.push({ table, value });
      inserting = true;
      return q;
    },
    delete: self,
    update: self,
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: inserting && table === 'payment_transactions' ? mocks.pendingInsertError : null,
      }),
  });
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.userRpc })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminQuery, rpc: mocks.adminRpc })),
}));

vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));

vi.mock('@/lib/services/product-validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/product-validation')>();
  return {
    ...actual,
    ProductValidationService: {
      validateEmail: vi.fn().mockResolvedValue(true),
      validateTemporalAvailability: actual.ProductValidationService.validateTemporalAvailability,
    },
  };
});

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => ({
    checkout: {
      sessions: {
        create: mocks.sessionsCreate,
        retrieve: mocks.sessionsRetrieve,
        expire: mocks.sessionsExpire,
      },
    },
  })),
}));

vi.mock('@/lib/stripe/checkout-config', () => ({
  getCheckoutConfig: vi.fn().mockResolvedValue({
    tax_mode: 'local',
    automatic_tax: { enabled: false },
    tax_id_collection: { enabled: false },
    billing_address_collection: 'auto',
    expires_hours: 24,
  }),
}));

vi.mock('@/lib/stripe/customer', () => ({
  getOrCreateStripeCustomer: mocks.getOrCreateStripeCustomer,
}));

vi.mock('@/lib/stripe/tax-rate-manager', () => ({
  getOrCreateStripeTaxRate: vi.fn().mockResolvedValue(undefined),
  resolveLocalSubscriptionTaxRateId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/security/checkout-binding', () => ({
  signCheckoutBinding: vi.fn(() => 'binding'),
  verifyCheckoutBinding: mocks.verifyBinding,
}));

import { POST } from '@/app/api/create-payment-intent/route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/create-payment-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: PRODUCT.id, ...body }),
  });
}

const SIGNED_IN = { id: 'user-1', email: 'account@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminInserts.length = 0;
  mocks.pendingInsertError = null;
  mocks.productOverride = {};
  mocks.verifyBinding.mockReturnValue(false);
  mocks.adminRpc.mockResolvedValue({ data: { valid: false, error: 'Invalid coupon' }, error: null });
  mocks.sessionsCreate.mockResolvedValue({ id: 'cs_test_1', client_secret: 'cs_test_1_secret_x' });
});

describe('POST /api/create-payment-intent — buyer email', () => {
  it('checks coupons against the account email for a signed-in buyer', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });

    await POST(makeRequest({ email: 'someone-else@example.com', couponCode: 'vip' }));

    const verifyCall = mocks.adminRpc.mock.calls.find(([name]) => name === 'verify_coupon');
    expect(verifyCall?.[1]).toMatchObject({ customer_email_param: 'account@example.com' });
  });

  it('puts the account email on the checkout session for a signed-in buyer', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });

    const res = await POST(makeRequest({ email: 'someone-else@example.com' }));

    expect(res.status).toBe(200);
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.customer_email).toBe('account@example.com');
    expect(params.metadata.email).toBe('account@example.com');
  });

  it('uses the form email for a guest', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    await POST(makeRequest({ email: 'guest@example.com', couponCode: 'vip' }));

    const verifyCall = mocks.adminRpc.mock.calls.find(([name]) => name === 'verify_coupon');
    expect(verifyCall?.[1]).toMatchObject({ customer_email_param: 'guest@example.com' });
  });
});

describe('POST /api/create-payment-intent — full-discount coupon', () => {
  const FULL_DISCOUNT = {
    valid: true,
    id: 'coupon-1',
    code: 'FREE100',
    discount_type: 'percentage',
    discount_value: 100,
    exclude_order_bumps: false,
  };

  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });
    mocks.adminRpc.mockImplementation(async (name: string) =>
      name === 'verify_coupon' ? { data: FULL_DISCOUNT, error: null } : { data: null, error: null },
    );
  });

  function adminRpcNames() {
    return mocks.adminRpc.mock.calls.map(([name]) => name);
  }

  it('grants through the signed-in client with the coupon code', async () => {
    mocks.userRpc.mockResolvedValue({ data: true, error: null });

    const res = await POST(makeRequest({ couponCode: 'free100' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ freeAccess: true });
    expect(mocks.userRpc).toHaveBeenCalledWith('grant_free_product_access', {
      product_slug_param: PRODUCT.slug,
      coupon_code_param: 'FREE100',
    });
    expect(adminRpcNames()).not.toContain('grant_free_product_access');
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('reports failure and records no redemption when the grant is refused', async () => {
    mocks.userRpc.mockResolvedValue({ data: false, error: null });

    const res = await POST(makeRequest({ couponCode: 'free100' }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).freeAccess).toBeUndefined();
    expect(mocks.adminInserts.filter((w) => w.table === 'coupon_redemptions')).toEqual([]);
    expect(adminRpcNames()).not.toContain('increment_coupon_usage');
  });
});

describe('POST /api/create-payment-intent — pending row', () => {
  it('stops the payment and expires the session when the pending row cannot be saved', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.pendingInsertError = { message: 'insert failed' };
    mocks.verifyBinding.mockReturnValue(true);
    mocks.sessionsRetrieve.mockResolvedValue({
      id: 'cs_test_1',
      status: 'open',
      payment_intent: null,
      metadata: { product_id: PRODUCT.id },
    });
    mocks.sessionsExpire.mockResolvedValue({});

    const res = await POST(makeRequest({ email: 'guest@example.com' }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.clientSecret).toBeUndefined();
    expect(mocks.sessionsExpire).toHaveBeenCalledWith('cs_test_1');
  });

  it('returns the client secret when the pending row is saved', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest({ email: 'guest@example.com' }));

    expect(res.status).toBe(200);
    expect((await res.json()).clientSecret).toBe('cs_test_1_secret_x');
    expect(mocks.sessionsExpire).not.toHaveBeenCalled();
  });
});

describe('POST /api/create-payment-intent — sale window', () => {
  const HOUR = 3600_000;
  const NOW = Date.parse('2026-10-22T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['one_time', 'ended', { available_until: new Date(NOW - HOUR).toISOString() }],
    ['one_time', 'not started', { available_from: new Date(NOW + HOUR).toISOString() }],
    ['subscription', 'ended', { available_until: new Date(NOW - HOUR).toISOString() }],
  ])('refuses a %s product whose sale window has %s', async (product_type, _label, window) => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.productOverride = { product_type, ...window };

    const res = await POST(makeRequest({ email: 'guest@example.com' }));

    expect(res.status).toBe(404);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('allows a product inside its sale window', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.productOverride = { available_until: new Date(NOW + HOUR).toISOString() };

    const res = await POST(makeRequest({ email: 'guest@example.com' }));

    expect(res.status).toBe(200);
  });
});
