import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  issue: vi.fn(),
  rate: vi.fn(),
  admin: vi.fn(),
  platform: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({ requireAdminApiWithRequest: mocks.auth }));
vi.mock('@/lib/license-keys/issue', () => ({ issueLicense: mocks.issue }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.admin,
  createPlatformClient: mocks.platform,
}));

import { POST } from '@/app/api/admin/licenses/route';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const LICENSE = '22222222-2222-4222-8222-222222222222';
const SELLER = '33333333-3333-4333-8333-333333333333';

function request(body: unknown) {
  return new NextRequest('https://sellf.example/api/admin/licenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_MODE;
  mocks.auth.mockResolvedValue({ user: { id: 'admin-1' }, role: 'platform_admin' });
  mocks.rate.mockResolvedValue(true);
  mocks.admin.mockReturnValue({});
  mocks.platform.mockReturnValue({ from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }) });
  mocks.issue.mockResolvedValue({ id: LICENSE, token: 'payload.signature', kid: 'kid-1', sellerId: SELLER });
});

describe('POST /api/admin/licenses', () => {
  it('is disabled on a public demo even for its administrator', async () => {
    process.env.DEMO_MODE = 'true';
    expect((await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'example.com' }))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it.each([
    ['Unauthorized', 401],
    ['Forbidden', 403],
  ])('rejects %s callers', async (message, status) => {
    mocks.auth.mockRejectedValue(new Error(message));
    expect((await POST(request({}))).status).toBe(status);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('rejects invalid and attacker-controlled system fields', async () => {
    const response = await POST(request({
      productId: PRODUCT,
      email: 'buyer@example.com',
      domain: 'example.com',
      sellerId: SELLER,
      orderId: 'attacker-order',
    }));
    expect(response.status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('rejects an unsafe domain before invoking the signer', async () => {
    const response = await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'user:pass@example.com/path' }));
    expect(response.status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('rate limits issuance per administrator', async () => {
    mocks.rate.mockResolvedValue(false);
    expect((await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'example.com' }))).status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith('admin_license_issue', 10, 60, 'admin-1');
  });

  it('issues through the existing signer with a server-generated order and manual source', async () => {
    const response = await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'App.Example.com' }));
    expect(response.status).toBe(201);
    expect(mocks.issue).toHaveBeenCalledWith({}, expect.objectContaining({
      productId: PRODUCT,
      email: 'buyer@example.com',
      userId: null,
      orderId: expect.stringMatching(/^manual_[0-9a-f-]{36}$/),
      source: 'manual',
      domain: 'App.Example.com',
      customFieldValues: {},
    }));
    const body = await response.json();
    expect(body.license).toMatchObject({ id: LICENSE, token: 'payload.signature', sellerId: SELLER });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not return or log a token when issuance cannot proceed', async () => {
    mocks.issue.mockResolvedValue(null);
    const response = await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'example.com' }));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('payload.signature');
  });
});
