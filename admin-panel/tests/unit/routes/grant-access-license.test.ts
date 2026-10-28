/** Grant route validates custom fields and forwards them to the shared grant service. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), grant: vi.fn(), track: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/services/free-product-access', () => ({ grantFreeProductAccess: mocks.grant }));
vi.mock('@/lib/tracking', () => ({ trackServerSideConversion: mocks.track }));
import { POST } from '@/app/api/public/products/[slug]/grant-access/route';

const product = { id: 'product-free', slug: 'free-guide', name: 'Free guide', price: 0, currency: 'PLN', is_active: true,
  custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] };
const user = { id: 'buyer', email: 'buyer@example.com' };
function request(body?: unknown) {
  return new NextRequest('http://localhost/api/public/products/free-guide/grant-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const context = { params: Promise.resolve({ slug: product.slug }) };
describe('free grant route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({ data: product, error: null }) };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: () => chain });
    mocks.grant.mockResolvedValue({ accessGranted: true, alreadyHadAccess: false, otoInfo: null });
    mocks.track.mockResolvedValue(undefined);
  });
  it('forwards the validated license domain to the shared grant service', async () => {
    expect((await POST(request({ customFieldValues: { _sellf_license_domain: 'client.example' } }), context)).status).toBe(200);
    expect(mocks.grant).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ product: { id: product.id, slug: product.slug }, user, customFieldValues: { _sellf_license_domain: 'client.example' } }));
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { _sellf_license_domain: 'not a domain' }])('rejects invalid submitted custom fields %j', async fields => {
    expect((await POST(request({ customFieldValues: fields }), context)).status).toBe(400);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it('allows the guest callback without custom fields', async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.grant.mock.calls[0][2]).not.toHaveProperty('customFieldValues');
  });
  it('does not track repeat grants', async () => {
    mocks.grant.mockResolvedValue({ accessGranted: true, alreadyHadAccess: true, otoInfo: null });
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
