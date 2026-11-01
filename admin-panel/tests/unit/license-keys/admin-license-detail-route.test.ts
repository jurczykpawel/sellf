import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), admin: vi.fn(),  trigger: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApiWithRequest: mocks.auth }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin, createPlatformClient: mocks.admin }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: mocks.trigger } }));

import { DELETE, GET } from '@/app/api/admin/licenses/[id]/route';

const ID = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: ID }) };
const request = (origin = 'https://sellf.example') => new NextRequest(`${origin}/api/admin/licenses/${ID}`);

function selectChain(data: unknown) {
  const chain = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  chain.eq.mockReturnValue(chain);
  return { select: vi.fn().mockReturnValue(chain) };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_MODE;
  delete process.env.SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  mocks.auth.mockResolvedValue({ user: { id: 'admin-1' }, role: 'platform_admin' });
  mocks.rate.mockResolvedValue(true);
  mocks.trigger.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

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

  it('commits the permanent decision through the atomic operation', async () => {
    const rpc=vi.fn().mockResolvedValue({data:[{id:ID,changed:true}],error:null});
    mocks.admin.mockReturnValue({rpc});
    const response=await DELETE(request(),context);expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('revoke_issued_licenses',{p_license_ids:[ID],p_actor:'admin-1'});
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it('reports a failed state write without sending a notification', async () => {
    mocks.admin.mockReturnValue({rpc:vi.fn().mockResolvedValue({data:null,error:{message:'unavailable'}})});
    expect((await DELETE(request(),context)).status).toBe(500);expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it('accepts an unchanged revocation while preserving the manual decision', async () => {
    mocks.admin.mockReturnValue({rpc:vi.fn().mockResolvedValue({data:[{id:ID,changed:false}],error:null})});
    expect((await DELETE(request(),context)).status).toBe(200);expect(mocks.trigger).not.toHaveBeenCalled();
  });
});
