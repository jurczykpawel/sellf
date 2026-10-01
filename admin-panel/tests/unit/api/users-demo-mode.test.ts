import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
  createPlatformClient: mocks.createAdminClient,
}));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.requireAdminApi }));

import { POST as postUsers } from '@/app/api/users/route';
import { POST as grantAccess, DELETE as revokeAccess } from '@/app/api/users/[id]/access/route';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';
const params = { params: Promise.resolve({ id: USER_ID }) };

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectDemoBlocked(res: Response) {
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe('DEMO_MODE');
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
}

describe('user access mutations in demo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DEMO_MODE', 'true');
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-1' } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('POST /api/users is rejected', async () => {
    const res = await postUsers(
      jsonRequest('http://localhost/api/users', 'POST', { userId: USER_ID, productId: PRODUCT_ID, action: 'grant' }),
    );
    await expectDemoBlocked(res);
  });

  it('POST /api/users/[id]/access is rejected', async () => {
    const res = await grantAccess(
      jsonRequest(`http://localhost/api/users/${USER_ID}/access`, 'POST', { product_id: PRODUCT_ID }),
      params,
    );
    await expectDemoBlocked(res);
  });

  it('DELETE /api/users/[id]/access is rejected', async () => {
    const res = await revokeAccess(
      jsonRequest(`http://localhost/api/users/${USER_ID}/access?product_id=${PRODUCT_ID}`, 'DELETE'),
      params,
    );
    await expectDemoBlocked(res);
  });

  it('still answers 401 to a non-admin', async () => {
    mocks.requireAdminApi.mockRejectedValue(new Error('Unauthorized'));
    const res = await revokeAccess(
      jsonRequest(`http://localhost/api/users/${USER_ID}/access?product_id=${PRODUCT_ID}`, 'DELETE'),
      params,
    );
    expect(res.status).toBe(401);
  });
});
