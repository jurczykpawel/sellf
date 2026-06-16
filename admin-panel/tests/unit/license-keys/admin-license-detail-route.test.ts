import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), admin: vi.fn(), platform: vi.fn(), checkFeature: vi.fn(), trigger: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApiWithRequest: mocks.auth }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin, createPlatformClient: mocks.platform }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: mocks.checkFeature }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: mocks.trigger } }));

import { DELETE, GET } from '@/app/api/admin/licenses/[id]/route';

const ID = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: ID }) };
const request = () => new NextRequest(`https://sellf.example/api/admin/licenses/${ID}`);

function selectChain(data: unknown) {
  const chain = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  chain.eq.mockReturnValue(chain);
  return { select: vi.fn().mockReturnValue(chain) };
}

function updateChain(data: unknown) {
  const chain = { eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  chain.eq.mockReturnValue(chain); chain.is.mockReturnValue(chain); chain.select.mockReturnValue(chain);
  return { update: vi.fn().mockReturnValue(chain) };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_MODE;
  mocks.auth.mockResolvedValue({ user: { id: 'admin-1' }, role: 'platform_admin' });
  mocks.rate.mockResolvedValue(true);
  mocks.platform.mockReturnValue({ from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }) });
  mocks.checkFeature.mockResolvedValue(true);
  mocks.trigger.mockResolvedValue(undefined);
});

const revokedRow = {
  id: ID,
  product_id: 'product-1',
  email: 'buyer@example.com',
  order_id: 'manual-order',
  seller_id: 'seller-1',
  license_domain: 'buyer.example.com',
  issuance_source: 'purchase',
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: null,
  revoked_at: '2026-06-16T10:00:00.000Z',
  products: { name: 'Plugin', slug: 'plugin', license_tier: 'pro' },
};

describe('/api/admin/licenses/:id', () => {
  it('does not expose license data in public demo mode', async () => {
    process.env.DEMO_MODE = 'true';
    expect((await GET(request(), context)).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it('never reveals a token without admin authentication', async () => {
    mocks.auth.mockRejectedValue(new Error('Unauthorized'));
    expect((await GET(request(), context)).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('reveals one token with no-store and a per-admin rate limit', async () => {
    mocks.admin.mockReturnValue({ from: () => selectChain({ license_key: 'payload.signature' }) });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ token: 'payload.signature' });
    expect(mocks.rate).toHaveBeenCalledWith('admin_license_reveal', 30, 60, 'admin-1');
  });

  it('revokes idempotently and audits without storing the token', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    mocks.admin.mockReturnValue({ from: () => updateChain(revokedRow) });
    mocks.platform.mockReturnValue({ from: () => ({ insert: auditInsert }) });
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    const auditPayload = auditInsert.mock.calls[0][0];
    expect(JSON.stringify(auditPayload)).not.toContain('payload.signature');
    expect(auditPayload.operation).toBe('LICENSE_REVOKED');
  });

  it('fires the license.revoked webhook (Pro) after a successful revocation', async () => {
    mocks.admin.mockReturnValue({ from: () => updateChain(revokedRow) });
    mocks.checkFeature.mockResolvedValue(true);
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.checkFeature).toHaveBeenCalledWith('license-revoked-webhook', { dataClient: expect.anything() });
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    const [event, payload, , productId] = mocks.trigger.mock.calls[0];
    expect(event).toBe('license.revoked');
    expect(productId).toBe('product-1');
    expect(payload.license.id).toBe(ID);
    expect(payload.crlUrl).toContain('/api/licenses/revoked?seller=seller-1');
    expect(JSON.stringify(payload)).not.toContain('payload.signature');
  });

  it('does not fire the webhook when the Pro feature is inactive', async () => {
    mocks.admin.mockReturnValue({ from: () => updateChain(revokedRow) });
    mocks.checkFeature.mockResolvedValue(false);
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('does not fire the webhook when nothing was revoked (already revoked)', async () => {
    mocks.admin.mockReturnValue({ from: () => updateChain(null) });
    const response = await DELETE(request(), context);
    expect(response.status).toBe(404);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});
