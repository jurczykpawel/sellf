import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Behavioural tests for POST /api/create-payment-intent (one-time path).
 * Supabase, Stripe and config lookups are mocked; pricing runs for real.
 */

vi.mock('@/lib/services/free-access-events', () => ({ emitFreeAccessLead: mocks.emitFreeAccessLead }));

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
  emitFreeAccessLead: vi.fn(),
  userRpc: vi.fn(),
  adminRpc: vi.fn(),
  adminInserts: [] as Array<{ table: string; value: unknown }>,
  getOrCreateStripeCustomer: vi.fn(),
  sessionsCreate: vi.fn(),
  piUpdate: vi.fn(),
  piRetrieve: vi.fn(),
  subscriptionUpdate: vi.fn(),
  dynamicSubscription: vi.fn(),
  sessionsRetrieve: vi.fn(),
  sessionsExpire: vi.fn(),
  sessionsUpdate: vi.fn(),
  verifyBinding: vi.fn(() => false),
  pendingInsertError: null as { message: string } | null,
  pendingInsertThrows: false,
  productOverride: {} as Record<string, unknown>,
  existingAccess: false,
  drift: false,
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
    maybeSingle: async () => ({ data: table === 'user_product_access' && mocks.existingAccess ? { access_expires_at: null } : null, error: null }),
    insert: (value: unknown) => {
      if (table === 'payment_transactions' && mocks.pendingInsertThrows) throw new Error('insert threw');
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
vi.mock('@/lib/telemetry/identity', () => ({ readInstanceId: vi.fn(async () => 'route-test-installation') }));

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
    paymentIntents: { update: mocks.piUpdate, retrieve: mocks.piRetrieve },
    subscriptions: { update: mocks.subscriptionUpdate },
    checkout: {
      sessions: {
        create: mocks.sessionsCreate,
        retrieve: mocks.sessionsRetrieve,
        expire: mocks.sessionsExpire,
        update: mocks.sessionsUpdate,
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

vi.mock('@/lib/license-keys/lookup', () => ({ findIssuedLicense: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/services/checkout-line-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/checkout-line-items')>();
  return { ...actual, buildCheckoutLineSpecs: (params: Parameters<typeof actual.buildCheckoutLineSpecs>[0]) => {
    const result = actual.buildCheckoutLineSpecs(params);
    if (mocks.drift) result.specs[0].unitAmountMinor++;
    return result;
  }};
});

vi.mock('@/lib/stripe/product-price', () => ({ getOrCreateStripePriceForProduct: vi.fn().mockResolvedValue('price_sub') }));
vi.mock('@/lib/stripe/ensure-product', () => ({ ensureStripeProduct: vi.fn().mockResolvedValue('prod_sub') }));
vi.mock('@/lib/stripe/subscription-dynamic-price', () => ({ createSubscriptionWithDynamicPrice: mocks.dynamicSubscription }));

import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { POST } from '@/app/api/create-payment-intent/route';
import { getStripeInstanceId } from '@/lib/stripe/instance-marker';

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
  mocks.pendingInsertThrows = false;
  mocks.productOverride = {};
  mocks.existingAccess = false;
  mocks.drift = false;
  mocks.verifyBinding.mockReturnValue(false);
  mocks.adminRpc.mockImplementation(async (name: string) => {
    if (name === 'place_order') {
      if (mocks.pendingInsertThrows) throw new Error('insert threw');
      return { data: { success: true, transaction_id: 'tx-1', order_number: 1001, amount: 10000 }, error: mocks.pendingInsertError };
    }
    return { data: { valid: false, error: 'Invalid coupon' }, error: null };
  });
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

    const res = await POST(makeRequest({ couponCode: 'free100', locale: 'pl' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ freeAccess: true });
    expect(mocks.emitFreeAccessLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locale: 'pl' }));
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
  it.each(['returned error', 'thrown exception'])('stops the payment and expires the session on pending insert %s', async (failure) => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.pendingInsertError = failure === 'returned error' ? { message: 'insert failed' } : null;
    mocks.pendingInsertThrows = failure === 'thrown exception';
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

  it('marks the Checkout Session and its PaymentIntent with this installation', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(makeRequest({ email: 'guest@example.com' }))).status).toBe(200);
    const sellf_instance = await getStripeInstanceId();
    expect(mocks.sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ sellf_instance }),
      payment_intent_data: expect.objectContaining({ metadata: expect.objectContaining({ sellf_instance }) }),
    }));
  });

  it('marks a subscription Checkout Session and its subscription', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });
    mocks.getOrCreateStripeCustomer.mockResolvedValue('cus_sub');
    mocks.productOverride = { product_type: 'subscription', billing_interval: 'month', billing_interval_count: 1, recurring_price: 10, stripe_price_id: 'price_sub' };
    vi.mocked(getCheckoutConfig).mockResolvedValueOnce({ ...(await getCheckoutConfig()), paymentMethodMode: 'automatic' });
    expect((await POST(makeRequest({}))).status).toBe(200);
    const sellf_instance = await getStripeInstanceId();
    expect(mocks.sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ sellf_instance }),
      subscription_data: expect.objectContaining({ metadata: expect.objectContaining({ sellf_instance }) }),
    }));
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

describe('order placement', () => {
  it('stores the builder snapshot and order context through the RPC', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(makeRequest({ email: 'guest@example.com' }))).status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith('place_order', {
      p_order: expect.objectContaining({ payment_provider: 'stripe', session_id: 'cs_test_1', customer_email: 'guest@example.com', coupon_id: null, custom_field_values: {}, metadata: expect.objectContaining({ bump_product_ids_full: [] }) }),
      p_lines: [expect.objectContaining({ product_id: PRODUCT.id, discounted_total: 100, total_price: 100, quantity: 1 })],
    });
    expect(mocks.adminInserts.filter(w => w.table === 'payment_transactions')).toHaveLength(0);
  });
  it.each([false, true])('repeat purchase flag %s governs existing access', async (allow_repeat_purchase) => {
    mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });
    mocks.existingAccess = true;
    mocks.productOverride = { allow_repeat_purchase };
    expect((await POST(makeRequest({}))).status).toBe(allow_repeat_purchase ? 200 : 400);
  });
});

it('refuses mismatched line totals before creating a Stripe session', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.drift = true;
  expect((await POST(makeRequest({}))).status).toBe(500);
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it('pins the subscription context on a dynamic-price payment intent', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });
  mocks.getOrCreateStripeCustomer.mockResolvedValue('cus_sub');
  mocks.dynamicSubscription.mockResolvedValue({ clientSecret: 'pi_subtest_secret_value', subscriptionId: 'sub_test' });
  mocks.productOverride = { product_type: 'subscription', allow_custom_price: true, custom_price_min: 1, billing_interval: 'month', billing_interval_count: 1, recurring_price: 10 };
  expect((await POST(makeRequest({ customAmount: 10 }))).status).toBe(200);
  expect(mocks.piUpdate).toHaveBeenCalledWith('pi_subtest', {
    metadata: expect.objectContaining({ product_id: PRODUCT.id, product_type: 'subscription', subscription_id: 'sub_test', user_id: SIGNED_IN.id, sellf_instance: await getStripeInstanceId() }),
  });
  expect(mocks.dynamicSubscription).toHaveBeenCalledWith(expect.objectContaining({ instanceId: await getStripeInstanceId() }));
});


describe('checkout profile quantity', () => {
  beforeEach(() => { mocks.getUser.mockResolvedValue({ data: { user: null } }); });
  it.each([0, 2, 1.5, '2', null])('refuses non-default quantity without a profile: %s', async quantity => {
    expect((await POST(makeRequest({ quantity }))).status).toBe(400);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
  it.each([0, 6, 1.5, '3'])('refuses quantity outside profile bounds: %s', async quantity => {
    mocks.productOverride = { checkout_profile: { v: 1, modules: [{ id: 'quantity', mode: 'checkout', min: 2, max: 5 }] } };
    expect((await POST(makeRequest({ quantity }))).status).toBe(400);
  });
  it('saves three units and charges a whole Stripe line', async () => {
    mocks.productOverride = { checkout_profile: { v: 1, modules: [{ id: 'quantity', mode: 'checkout', min: 1, max: 5 }] } };
    expect((await POST(makeRequest({ quantity: 3 }))).status).toBe(200);
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items[0]).toMatchObject({ quantity: 1, price_data: { unit_amount: 30000, product_data: { name: 'Course × 3' } } });
    const order = mocks.adminRpc.mock.calls.find(([name]) => name === 'place_order');
    expect(order?.[1].p_lines[0]).toMatchObject({ quantity: 3, unit_price: 100, total_price: 300 });
  });
  it('accepts only the minimum for hidden quantity', async () => {
    mocks.productOverride = { checkout_profile: { v: 1, modules: [{ id: 'quantity', mode: 'hidden', min: 2, max: 5 }] } };
    expect((await POST(makeRequest({ quantity: 3 }))).status).toBe(400);
    expect((await POST(makeRequest({ quantity: 2 }))).status).toBe(200);
  });
});


describe('event checkout', () => {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  beforeEach(() => {
    mocks.productOverride = { event_mode: true };
    mocks.getUser.mockResolvedValue({ data: { user: null } });
  });
  it('requires a session for an event', async () => {
    expect((await POST(makeRequest({ email: 'buyer@example.com' }))).status).toBe(400);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
  it('refuses a full session before creating Stripe checkout', async () => {
    mocks.adminRpc.mockResolvedValue({ data: [], error: null });
    expect((await POST(makeRequest({ sessionId, email: 'buyer@example.com' }))).status).toBe(409);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
  function available(limits = true, failureCode?: string) {
    const original = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'event_availability') return { data: [{ id: sessionId, title: 'Autumn', starts_at: '2099-01-01T12:00:00Z', remaining: 60,
        current_tier: { id: 'tier', price: 47, seats_left: 30 } }], error: null };
      if (name === 'event_hold_limits') return { data: limits, error: null };
      if (name === 'place_order' && failureCode) return { data: null, error: { code: failureCode, message: failureCode === 'P0429' ? 'event_hold_limit' : 'sold_out' } };
      return original(name, args);
    });
    mocks.sessionsCreate.mockImplementation(async (params: { expires_at: number }) => ({
      id: 'cs_test_1', client_secret: 'cs_test_1_secret_x', expires_at: params.expires_at,
    }));
  }
  it('charges the authoritative tier and saves the same Stripe expiry and session', async () => {
    available();
    const before = Math.floor(Date.now() / 1000);
    const response = await POST(makeRequest({ sessionId, email: 'buyer@example.com' }));
    expect(response.status).toBe(200);
    const params = mocks.sessionsCreate.mock.calls[0][0];
    expect(params.line_items[0].price_data.unit_amount).toBe(4700);
    expect(params.expires_at).toBeGreaterThanOrEqual(before + 1800);
    expect(params.expires_at).toBeLessThanOrEqual(Math.floor(Date.now()/1000) + 1800);
    const args = mocks.adminRpc.mock.calls.find(([name]) => name === 'place_order')![1];
    expect(args.p_lines[0]).toMatchObject({ unit_price: 47, session_id: sessionId });
    expect(Date.parse(args.p_order.expires_at)/1000).toBe(params.expires_at);
  });
  it('returns 429 before Stripe when active holds reach the limit', async () => {
    available(false);
    expect((await POST(makeRequest({ sessionId, email: 'buyer@example.com' }))).status).toBe(429);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
  it.each([['P0409',409],['P0429',429]])('preserves atomic placement error %s after closing Stripe', async (code, status) => {
    available(true, code as string);
    mocks.verifyBinding.mockReturnValue(true);
    mocks.sessionsRetrieve.mockResolvedValue({ status: 'open', metadata: { product_id: PRODUCT.id } });
    const response = await POST(makeRequest({ sessionId, email: 'buyer@example.com' }));
    expect(response.status).toBe(status);
    expect(mocks.sessionsExpire).toHaveBeenCalledWith('cs_test_1');
  });
  it('keeps ordinary checkout expiry unchanged', async () => {
    mocks.productOverride = {};
    expect((await POST(makeRequest({ email: 'buyer@example.com' }))).status).toBe(200);
    expect(mocks.sessionsCreate.mock.calls[0][0].expires_at).toBeUndefined();
  });

});


it('attaches a customer and enables automatic tax for a profile in Stripe Tax mode', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.getOrCreateStripeCustomer.mockResolvedValue('cus_profile');
  mocks.productOverride = { checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'] }] } };
  vi.mocked(getCheckoutConfig).mockResolvedValueOnce({ tax_mode: 'stripe_tax', automatic_tax: { enabled: true }, tax_id_collection: { enabled: false }, billing_address_collection: 'auto', expires_hours: 24 } as Awaited<ReturnType<typeof getCheckoutConfig>>);
  expect((await POST(makeRequest({ email: 'company@example.com' }))).status).toBe(200);
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_profile', automatic_tax: { enabled: true } }));
});

it.each(['pl', 'en'])('saves checkout language %s on the session and intent', async locale => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await POST(makeRequest({ locale }))).status).toBe(200);
  const params = mocks.sessionsCreate.mock.calls[0][0];
  expect(params.metadata.locale).toBe(locale);
  expect(params.payment_intent_data.metadata.locale).toBe(locale);
});
it.each(['pl', 'en'])('saves checkout language %s for dynamic subscriptions and their intent', async locale => {
  mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });
  mocks.getOrCreateStripeCustomer.mockResolvedValue('cus_sub');
  mocks.dynamicSubscription.mockResolvedValue({ clientSecret: 'pi_subtest_secret_value', subscriptionId: 'sub_test' });
  mocks.productOverride = { product_type: 'subscription', allow_custom_price: true, custom_price_min: 1, billing_interval: 'month', billing_interval_count: 1, recurring_price: 10 };
  expect((await POST(makeRequest({ customAmount: 10, locale }))).status).toBe(200);
  expect(mocks.subscriptionUpdate).toHaveBeenCalledWith('sub_test', { metadata: { locale } });
  expect(mocks.piUpdate).toHaveBeenCalledWith('pi_subtest', { metadata: expect.objectContaining({ locale }) });
});

describe('cart change on an open checkout session (W219)', () => {
  const OPEN_SECRET = 'cs_test_open_secret_value';
  const EVENT_SESSION = '22222222-2222-4222-8222-222222222222';
  const EMAIL = 'guest@example.com';
  const QUANTITY_PROFILE = { checkout_profile: { v: 1, modules: [{ id: 'quantity', mode: 'checkout', min: 1, max: 5 }] } };
  type Params = { line_items: Array<{ price_data: { unit_amount: number } }>; metadata: Record<string, string>; payment_intent_data: { metadata: Record<string, string> } };
  let session: Record<string, unknown>;
  const sum = (params: Params) => params.line_items.reduce((total, item) => total + item.price_data.unit_amount, 0);
  const rpcCalls = (name: string) => mocks.adminRpc.mock.calls.filter(([called]) => called === name);
  const change = (body: Record<string, unknown>) => POST(makeRequest({ email: EMAIL, clientSecret: OPEN_SECRET, bindingToken: 'binding', ...body }));

  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.verifyBinding.mockReturnValue(true);
    mocks.productOverride = QUANTITY_PROFILE;
    session = {
      id: 'cs_test_open', object: 'checkout.session', status: 'open', mode: 'payment', ui_mode: 'elements', locale: 'en',
      payment_intent: null, expires_at: Math.floor(Date.now() / 1000) + 3600, client_secret: OPEN_SECRET,
      metadata: { product_id: PRODUCT.id, user_id: '', email: EMAIL, success_url: '', sf_attr_ref: 'first-visit' },
    };
    mocks.sessionsRetrieve.mockImplementation(async () => session);
    mocks.sessionsExpire.mockResolvedValue({});
    mocks.sessionsUpdate.mockImplementation(async (_id: string, params: Params) => ({ ...session, amount_subtotal: sum(params) }));
    const original = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === 'replace_pending_order') return { data: { success: true, transaction_id: 'tx-1', amount: 0 }, error: null };
      if (name === 'verify_coupon') return { data: { valid: true, id: 'coupon-1', code: 'HALF', discount_type: 'percentage', discount_value: 50, exclude_order_bumps: false }, error: null };
      return original(name, args);
    });
  });

  it('updates the same session when the quantity changes and never creates or expires one', async () => {
    const response = await change({ quantity: 3 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ clientSecret: OPEN_SECRET, checkoutSessionId: 'cs_test_open' });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(mocks.sessionsExpire).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate).toHaveBeenCalledTimes(1);
    const [id, params] = mocks.sessionsUpdate.mock.calls[0] as [string, Params];
    expect(id).toBe('cs_test_open');
    expect(sum(params)).toBe(30000);
    expect(rpcCalls('place_order')).toHaveLength(0);
    expect(rpcCalls('replace_pending_order')[0][1]).toMatchObject({
      p_order: expect.objectContaining({ session_id: 'cs_test_open', customer_email: EMAIL, coupon_id: null }),
      p_lines: [expect.objectContaining({ product_id: PRODUCT.id, quantity: 3, total_price: 300, discounted_total: 300 })],
    });
  });

  it('applies a coupon to the open session with matching amount, metadata and installation marker', async () => {
    expect((await change({ quantity: 2, couponCode: 'half' })).status).toBe(200);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    const params = mocks.sessionsUpdate.mock.calls[0][1] as Params;
    expect(sum(params)).toBe(10000);
    const sellf_instance = await getStripeInstanceId();
    expect(params.metadata).toMatchObject({ coupon_id: 'coupon-1', has_coupon: 'true', product_id: PRODUCT.id, sellf_instance, sf_attr_ref: 'first-visit' });
    expect(params.payment_intent_data.metadata).toMatchObject({ coupon_id: 'coupon-1', sellf_instance });
    expect(rpcCalls('replace_pending_order')[0][1].p_order).toMatchObject({ coupon_id: 'coupon-1', metadata: expect.objectContaining({ coupon_id: 'coupon-1' }) });
  });

  it('keeps one session across successive cart changes', async () => {
    for (const quantity of [2, 4, 1]) expect((await change({ quantity })).status).toBe(200);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(mocks.sessionsUpdate.mock.calls.map(([, params]) => sum(params as Params))).toEqual([20000, 40000, 10000]);
  });

  it.each([
    ['a different email', () => { session.metadata = { ...(session.metadata as object), email: 'other@example.com' }; }],
    ['a different language', () => { session.locale = 'pl'; }],
    ['a completed session', () => { session.status = 'complete'; }],
    ['a payment already in progress', () => { session.payment_intent = { id: 'pi_1', status: 'processing' }; mocks.piRetrieve.mockResolvedValue({ id: 'pi_1', status: 'processing' }); }],
    ['an event product', () => {
      mocks.productOverride = { ...QUANTITY_PROFILE, event_mode: true };
      const original = mocks.adminRpc.getMockImplementation()!;
      mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => {
        if (name === 'event_availability') return { data: [{ id: EVENT_SESSION, title: 'Autumn', starts_at: '2099-01-01T12:00:00Z', remaining: 60, current_tier: { id: 'tier', price: 47, seats_left: 30 } }], error: null };
        if (name === 'event_hold_limits') return { data: true, error: null };
        return original(name, args);
      });
    }],
  ])('creates a new session instead of updating %s', async (_label, arrange) => {
    arrange();
    mocks.sessionsCreate.mockImplementation(async (params: { expires_at?: number }) => ({ id: 'cs_test_new', client_secret: 'cs_test_new_secret_x', expires_at: params.expires_at ?? 0 }));
    const response = await change({ quantity: 2, sessionId: EVENT_SESSION });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ checkoutSessionId: 'cs_test_new' });
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
    expect(rpcCalls('replace_pending_order')).toHaveLength(0);
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('replaces the session when the order snapshot cannot be updated', async () => {
    const original = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'replace_pending_order' ? { data: { success: false, error: 'order_not_replaceable' }, error: null } : original(name, args));
    const response = await change({ quantity: 2 });
    expect(response.status).toBe(200);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionsExpire).toHaveBeenCalledWith('cs_test_open');
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('replaces the session when Stripe reports a total different from the cart', async () => {
    mocks.sessionsUpdate.mockImplementation(async () => ({ ...session, amount_subtotal: 1 }));
    const response = await change({ quantity: 2 });
    expect(response.status).toBe(200);
    expect(mocks.sessionsExpire).toHaveBeenCalledWith('cs_test_open');
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(sum(mocks.sessionsCreate.mock.calls[0][0] as Params)).toBe(20000);
  });

  it('refuses to update a session bound to someone else', async () => {
    mocks.verifyBinding.mockReturnValue(false);
    expect((await change({ quantity: 2 })).status).toBe(403);
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(rpcCalls('replace_pending_order')).toHaveLength(0);
  });

  it('closes the open session when a full-discount coupon grants access instead', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN } });
    session.metadata = { ...(session.metadata as object), user_id: SIGNED_IN.id, email: SIGNED_IN.email };
    const original = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => name === 'verify_coupon'
      ? { data: { valid: true, id: 'coupon-free', code: 'FREE', discount_type: 'percentage', discount_value: 100, exclude_order_bumps: false }, error: null }
      : original(name, args));
    mocks.userRpc.mockResolvedValue({ data: { success: true }, error: null });
    await change({ couponCode: 'free' });
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionsExpire).toHaveBeenCalledWith('cs_test_open');
  });
});
