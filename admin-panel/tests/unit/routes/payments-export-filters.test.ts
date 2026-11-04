/** @see src/app/api/v1/payments/export/route.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ from: vi.fn(), auth: vi.fn(), rate: vi.fn(), tier: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), authenticate: mocks.auth }));
vi.mock('@/lib/rate-limiting', async (original) => ({ ...await original<typeof import('@/lib/rate-limiting')>(), checkRateLimit: mocks.rate }));
vi.mock('@/lib/license/resolve', () => ({ resolveCurrentTier: mocks.tier }));
import { POST } from '@/app/api/v1/payments/export/route';
function chain(data: unknown[]) {
  const query = {
    select: vi.fn(), order: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), or: vi.fn(), limit: vi.fn(), range: vi.fn(),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  for (const method of ['select', 'order', 'eq', 'gte', 'lte', 'or', 'limit', 'range'] as const) query[method].mockReturnValue(query);
  return query;
}
function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/payments/export', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}
let payments: ReturnType<typeof chain>;
let products: ReturnType<typeof chain>;
beforeEach(() => {
  vi.clearAllMocks();
  payments = chain([]);
  products = chain([{ id: '12345678-1234-4234-8234-123456789012' }]);
  mocks.from.mockImplementation(table => table === 'products' ? products : payments);
  mocks.auth.mockResolvedValue({ method: 'session', scopes: ['payments:read'], admin: { userId: 'admin' }, supabase: { from: mocks.from } });
  mocks.rate.mockResolvedValue(true);
  mocks.tier.mockResolvedValue('registered');
});
describe('payment export filters', () => {
  it('applies dashboard email search using the list search fields', async () => {
    expect((await POST(request({ searchTerm: 'buyer@example.com' }))).status).toBe(200);
    expect(payments.or).toHaveBeenCalledWith(expect.stringContaining('customer_email.imatch."buyer@example\\\\.com"'));
    expect(payments.or).toHaveBeenCalledWith(expect.stringContaining('session_id.imatch.'));
    expect(payments.or).toHaveBeenCalledWith(expect.stringContaining('stripe_payment_intent_id.imatch.'));
    expect(payments.or).toHaveBeenCalledWith(expect.stringContaining('product_id.in.'));
  });
  it('accepts API search and preserves literal punctuation', async () => {
    expect((await POST(request({ search: 'a%,(b)' }))).status).toBe(200);
    expect(products.or).toHaveBeenCalledWith('name.imatch."a%,\\\\(b\\\\)",slug.imatch."a%,\\\\(b\\\\)"');
  });
  it.each(['completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled', 'pending'])('filters status %s', async status => {
    expect((await POST(request({ status }))).status).toBe(200);
    expect(payments.eq).toHaveBeenCalledWith('status', status);
  });
  it('combines product and explicit date boundaries', async () => {
    const product_id = '12345678-1234-4234-8234-123456789012';
    expect((await POST(request({ product_id, date_from: '2026-01-01', date_to: '2026-02-01' }))).status).toBe(200);
    expect(payments.eq).toHaveBeenCalledWith('product_id', product_id);
    expect(payments.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00.000Z');
    expect(payments.lte).toHaveBeenCalledWith('created_at', '2026-02-01T00:00:00.000Z');
  });
  it('leaves all rows eligible without filters', async () => {
    expect((await POST(request({}))).status).toBe(200);
    expect(payments.eq).not.toHaveBeenCalled();
    expect(payments.or).not.toHaveBeenCalled();
    expect(payments.gte).not.toHaveBeenCalled();
  });
  it.each([{ searchTerm: 42 }, { searchTerm: 'x'.repeat(201) }, null, { date_from: 'invalid' }])('rejects invalid filters %j before quota', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it.each([['PLN', '246.00', '200.00', '46.00', '12.30'], ['JPY', '24600', '20000', '4600', '1230'], ['KRW', '24600', '20000', '4600', '1230'], ['VND', '24600', '20000', '4600', '1230']])('exports %s in major currency units', async (currency, amount, net, tax, refund) => {
    payments = chain([{ id: 'tx', currency, amount: 24600, net_total: 20000, tax_total: 4600, refunded_amount: 1230,
      created_at: '2026-01-01', updated_at: '2026-01-01', products: { name: 'Product' } }]);
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    const [headers, row] = (await response.text()).split('\n').map(line => line.split(',').map(cell => cell.slice(1, -1)));
    expect(row[headers.indexOf('Amount (major units)')]).toBe(amount);
    expect(row[headers.indexOf('Net Total (major units)')]).toBe(net);
    expect(row[headers.indexOf('Tax Total (major units)')]).toBe(tax);
    expect(row[headers.indexOf('Refunded Amount (major units)')]).toBe(refund);
  });
  it('uses the relative date range and leaves uncaptured tax values empty', async () => {
    vi.stubEnv('TZ', 'UTC');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    try {
      payments = chain([{ id: 'tx', currency: 'PLN', amount: 24600, net_total: null, tax_total: null,
        created_at: '2026-01-01', updated_at: '2026-01-01' }]);
      const response = await POST(request({ dateRange: '7' }));
      expect(payments.gte).toHaveBeenCalledWith('created_at', '2026-10-19T12:00:00.000Z');
      expect(await response.text()).toContain('"246.00","PLN","",""');
    } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
  });
  it('does not return unfiltered data when product search fails', async () => {
    products.then = resolve => Promise.resolve({ data: null, error: { message: 'unavailable' } }).then(resolve);
    expect((await POST(request({ search: 'product' }))).status).toBe(500);
    expect(payments.range).not.toHaveBeenCalled();
  });
  it('retains license and rate limits', async () => {
    mocks.tier.mockResolvedValueOnce('free');
    expect((await POST(request({}))).status).toBe(403);
    mocks.rate.mockResolvedValueOnce(false);
    expect((await POST(request({}))).status).toBe(429);
  });
});
