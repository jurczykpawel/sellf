import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  issue: vi.fn(),
  rate: vi.fn(),
  admin: vi.fn(),
  platform: vi.fn(),
  mail: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: mocks.mail }));

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

function request(body: unknown, origin = 'https://sellf.example') {
  return new NextRequest(`${origin}/api/admin/licenses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_MODE;
  delete process.env.SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  mocks.auth.mockResolvedValue({ user: { id: 'admin-1' }, role: 'platform_admin' });
  mocks.rate.mockResolvedValue(true);
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] }, error: null }) };
  mocks.admin.mockReturnValue({ from: () => query, rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.mail.mockResolvedValue({ ok: true });
  mocks.platform.mockReturnValue({ from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }) });
  mocks.issue.mockResolvedValue({ id: LICENSE, token: 'payload.signature', kid: 'kid-1', sellerId: SELLER });
});

afterEach(() => {
  delete process.env.SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
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
    expect(mocks.issue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      productId: PRODUCT,
      email: 'buyer@example.com',
      userId: null,
      orderId: expect.stringMatching(/^manual_[0-9a-f-]{36}$/),
      source: 'manual',
      customFieldValues: { _sellf_license_domain: 'app.example.com' },
    }));
    const body = await response.json();
    expect(body.license).toMatchObject({ id: LICENSE, token: 'payload.signature', sellerId: SELLER });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('builds the license URLs from the configured site URL, not the request Host header', async () => {
    process.env.SITE_URL = 'https://sellf.example.com';
    const response = await POST(request(
      { productId: PRODUCT, email: 'buyer@example.com', domain: 'example.com' },
      'https://other-host.example',
    ));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.license.jwksUrl).toBe(`https://sellf.example.com/api/licenses/jwks?seller=${SELLER}`);
    expect(body.license.crlUrl).toBe(`https://sellf.example.com/api/licenses/revoked?seller=${SELLER}`);
  });

  it('does not return or log a token when issuance cannot proceed', async () => {
    mocks.issue.mockResolvedValue(null);
    const response = await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'example.com' }));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('payload.signature');
  });
});

describe('buyer mail on manual issuance', () => {
  it('includes the signed license deadline in the buyer mail', async () => {
    const exp = 1796900400;
    const token = Buffer.from(JSON.stringify({ v:1, kid:'kid-1', product:'product', email:'buyer@example.com', order:'manual', tier:null, iat:1794308400, exp })).toString('base64url') + '.signature';
    mocks.issue.mockResolvedValue({ id: LICENSE, token, kid:'kid-1', sellerId:SELLER });
    const res = await POST(request({ productId:PRODUCT, email:'buyer@example.com', domain:'shop.example.com', locale:'pl' }));
    expect(res.status).toBe(201);
    expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ data:expect.objectContaining({ license_expires_at:new Date(exp*1000).toISOString(), license_expires_text:expect.stringContaining('grudnia 2026') }) }));
  });
  it('mails the key by default and clears it from account data, or skips on request', async () => {
    const res = await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'shop.example.com' }));
    expect(res.status).toBe(201);
    expect((await res.json()).license.emailSent).toBe(true);
    expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ email: 'buyer@example.com', data: expect.objectContaining({ license_key: 'payload.signature' }) }));
    expect(mocks.rpc).toHaveBeenCalledWith('prepare_event_mail', { p_email: 'buyer@example.com', p_data: { locale: 'en' } });
    mocks.mail.mockClear();
    const quiet = await POST(request({ productId: PRODUCT, email: 'buyer@example.com', domain: 'shop.example.com', sendEmail: false }));
    expect((await quiet.json()).license.emailSent).toBe(false);
    expect(mocks.mail).not.toHaveBeenCalled();
  });
});

describe('buyer mail language', () => {
  it('uses the buyer language over the seller panel language, falling back to the panel', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'buyer_mail_locale' ? { data: 'pl', error: null } : { error: null });
    await POST(request({ productId: PRODUCT, email: 'kupujacy@example.com', domain: 'shop.example.com', locale: 'en' }));
    expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ locale: 'pl' }) }));
    mocks.mail.mockClear();
    mocks.rpc.mockImplementation(async (name: string) => name === 'buyer_mail_locale' ? { data: null, error: null } : { error: null });
    await POST(request({ productId: PRODUCT, email: 'unknown@example.com', domain: 'shop.example.com', locale: 'pl' }));
    expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ locale: 'pl' }) }));
  });
});
