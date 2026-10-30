import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ captcha: vi.fn(), rpc: vi.fn(), from: vi.fn(), event: vi.fn(), rate: vi.fn(), identity: vi.fn(), invoice: vi.fn(), after: vi.fn(), token: vi.fn(), signer: vi.fn(), collect: true, user: null as null | { id: string; email: string } }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/invoicing/service', () => ({ issueInvoiceForTransaction: mocks.invoice }));
vi.mock('@/lib/orders/transfer-token', () => ({ signTransferToken: mocks.token, createTransferTokenSigner: mocks.signer }));
vi.mock('@/lib/orders/transfer-mail', () => ({ sendTransferAccessMail: vi.fn() }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: mocks.captcha }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/lib/stripe/checkout-config', () => ({ getCheckoutConfig: async () => ({ collect_terms_of_service: mocks.collect }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate, checkRateLimitForIdentifier: mocks.identity }));
vi.mock('@/lib/orders/bank-transfer-service', () => ({ dispatchTransferEvent: mocks.event }));
vi.mock('@/lib/events/checkout', () => ({ resolveEventCheckout: vi.fn() }));
vi.mock('@/lib/services/product-validation', () => ({ ProductValidationService: { validateEmail: async () => true, validateTemporalAvailability: vi.fn() } }));
import { POST } from '@/app/api/orders/bank-transfer/route';
const productId = '10000000-0000-4000-8000-000000000001';
const product = { id: productId, name: 'Workshop', price: 100, currency: 'PLN', vat_rate: 23, price_includes_vat: false,
  custom_checkout_fields: [], checkout_profile: { v: 1, modules: [
    { id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] },
    { id: 'quantity', min: 1, max: 10, mode: 'checkout' },
  ] } };
const body = { productId, email: 'buyer@example.com', termsAccepted: true, captchaToken: 'solved', moduleValues: {
  quantity: 2, buyer: { type: 'organization', company_name: 'Example', nip: '5260250274', address: 'Main 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
} };
function request(value: unknown) { return new NextRequest('http://localhost/api/orders/bank-transfer', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
}); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.collect = true; mocks.user = null; mocks.captcha.mockResolvedValue({ success: true }); mocks.rate.mockResolvedValue(true); mocks.identity.mockResolvedValue(true);
  mocks.event.mockResolvedValue(undefined); mocks.invoice.mockResolvedValue(null); mocks.token.mockReturnValue('signed'); mocks.signer.mockReturnValue(mocks.token);
  mocks.from.mockImplementation((table: string) => {
    const data = table === 'products' ? product : { bank_transfer_enabled: true, bank_account_holder: 'Example', bank_account_number: 'PL61109010140000071219812874' };
    const query = { select: () => query, eq: () => query, single: async () => ({ data, error: null }) }; return query;
  });
  mocks.rpc.mockImplementation(async (name: string) => name === 'get_product_order_bumps' ? { data: [], error: null }
    : { data: { transaction_id: productId, order_number: 1, amount: 24600, currency: 'PLN', dueAt: '2026-12-01', transfer: {} }, error: null });
});
describe('public bank transfer endpoint', () => {
  it('requires link configuration before writing an order', async () => {
    mocks.signer.mockImplementationOnce(() => { throw new Error('Configuration required'); });
    expect((await POST(request(body))).status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires a captcha token before touching order data', async () => {
    expect((await POST(request({ ...body, captchaToken: undefined }))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('uses single-use ALTCHA verification and refuses a consumed token', async () => {
    mocks.captcha.mockResolvedValue({ success: false });
    expect((await POST(request(body))).status).toBe(403);
    expect(mocks.captcha).toHaveBeenCalledWith('solved', 'altcha');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses module quantity and locally computed VAT without creating a Stripe object', async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('bank_transfer_order', expect.objectContaining({
      p_order: expect.objectContaining({ customer_email: body.email, order_details: expect.objectContaining({ buyer: expect.objectContaining({ terms_accepted: true }) }) }),
      p_lines: [expect.objectContaining({ quantity: 2, unit_price: 100, total_price: 200, vat_rate: 23, tax_behavior: 'exclusive' })],
    }));
    expect((await response.json()).amount).toBe(24600);
    expect(mocks.identity).toHaveBeenCalledTimes(2);
  });
  it('schedules automatic invoicing after the response and includes an order link token', async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBe('signed');
    expect(mocks.invoice).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.invoice).toHaveBeenCalledWith(productId, { client: expect.anything() });
  });
  it('refuses products without an enabled profile', async () => {
    const old = product.checkout_profile;
    try {
      Object.assign(product, { checkout_profile: null });
      expect((await POST(request(body))).status).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally { product.checkout_profile = old; }
  });
  it('maps the atomic unpaid limit to 429', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_product_order_bumps' ? { data: [] } : { error: { code: 'P0429' } });
    expect((await POST(request(body))).status).toBe(429);
  });
  it('keeps a placed order successful when webhook delivery awaits recovery', async () => {
    mocks.event.mockRejectedValueOnce(new Error('queue unavailable'));
    expect((await POST(request(body))).status).toBe(200);
  });
  it('refuses mismatched quantity and missing consent', async () => {
    expect((await POST(request({ ...body, quantity: 1 }))).status).toBe(400);
    expect((await POST(request({ ...body, termsAccepted: false }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it.each([[true, false, 400], [false, false, 200], [true, true, 200], [false, true, 200]])
  ('uses shop consent policy (collect=%s, signedIn=%s)', async (collect, signedIn, status) => {
    mocks.collect = collect as boolean;
    mocks.user = signedIn ? { id: 'buyer-id', email: body.email } : null;
    const { termsAccepted: _accepted, ...withoutAcceptance } = body;
    expect((await POST(request(withoutAcceptance))).status).toBe(status);
    if (status === 200) expect(mocks.rpc).toHaveBeenCalledWith('bank_transfer_order', expect.objectContaining({
      p_order: expect.objectContaining({ terms_required: false, order_details: expect.objectContaining({ buyer: expect.objectContaining({ terms_accepted: false }) }) }),
    }));
  });
