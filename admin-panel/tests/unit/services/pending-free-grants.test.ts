import { describe, it, expect, vi, beforeEach } from 'vitest';

const grantFreeProductAccess = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/free-product-access', () => ({ grantFreeProductAccess }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));

import {
  claimPendingFreeGrants,
  productSlugHandledByRedirect,
  queuePendingFreeGrant,
} from '@/lib/services/pending-free-grants';

function makeUserClient(rows: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: rows, error }) };
}

const USER = { id: 'user-1', email: 'buyer@example.com' };

describe('claimPendingFreeGrants', () => {
  beforeEach(() => {
    grantFreeProductAccess.mockReset();
    grantFreeProductAccess.mockResolvedValue({ accessGranted: true, alreadyHadAccess: false, otoInfo: null });
  });

  it('makes no database call when nothing is pending', async () => {
    const userClient = makeUserClient([]);

    const granted = await claimPendingFreeGrants({
      userClient: userClient as never,
      user: { ...USER, app_metadata: { provider: 'email' } },
    });

    expect(granted).toBe(0);
    expect(userClient.rpc).not.toHaveBeenCalled();
    expect(grantFreeProductAccess).not.toHaveBeenCalled();
  });

  it('grants every pending product except the one the redirect will handle', async () => {
    const userClient = makeUserClient([
      { product_id: 'p-a', slug: 'a' },
      { product_id: 'p-b', slug: 'b' },
    ]);

    const granted = await claimPendingFreeGrants({
      userClient: userClient as never,
      user: { ...USER, app_metadata: { pending_free_grants: ['p-a', 'p-b'] } },
      skipSlug: 'b',
    });

    expect(granted).toBe(1);
    expect(userClient.rpc).toHaveBeenCalledWith('pending_free_grant_products');
    expect(grantFreeProductAccess).toHaveBeenCalledTimes(1);
    expect(grantFreeProductAccess).toHaveBeenCalledWith(userClient, expect.anything(), {
      product: { id: 'p-a', slug: 'a' },
      user: { id: USER.id, email: USER.email },
    });
  });

  it('keeps going when one grant fails and never throws', async () => {
    grantFreeProductAccess
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ accessGranted: true, alreadyHadAccess: false, otoInfo: null });
    const userClient = makeUserClient([
      { product_id: 'p-a', slug: 'a' },
      { product_id: 'p-b', slug: 'b' },
    ]);

    const granted = await claimPendingFreeGrants({
      userClient: userClient as never,
      user: { ...USER, app_metadata: { pending_free_grants: ['p-a', 'p-b'] } },
    });

    expect(granted).toBe(1);
    expect(grantFreeProductAccess).toHaveBeenCalledTimes(2);
  });

  it('returns 0 without throwing when the lookup fails', async () => {
    const userClient = makeUserClient(null, { message: 'db down' });

    const granted = await claimPendingFreeGrants({
      userClient: userClient as never,
      user: { ...USER, app_metadata: { pending_free_grants: ['p-a'] } },
    });

    expect(granted).toBe(0);
    expect(grantFreeProductAccess).not.toHaveBeenCalled();
  });
});

describe('queuePendingFreeGrant', () => {
  beforeEach(() => {
    adminRpc.mockReset();
  });

  it('records the intent through the service-role RPC', async () => {
    adminRpc.mockResolvedValue({ data: true, error: null });

    await queuePendingFreeGrant('buyer@example.com', 'free-tutorial');

    expect(adminRpc).toHaveBeenCalledWith('queue_pending_free_grant', {
      p_email: 'buyer@example.com',
      p_product_slug: 'free-tutorial',
    });
  });

  it('never throws when the RPC fails', async () => {
    adminRpc.mockImplementation(async () => {
      throw new Error('network');
    });
    await expect(queuePendingFreeGrant('buyer@example.com', 'free-tutorial')).resolves.toBeUndefined();
  });
});

describe('productSlugHandledByRedirect', () => {
  it.each([
    ['/auth/product-access?product=free-tutorial&success_url=x', 'free-tutorial'],
    ['/pl/auth/product-access?product=kurs', 'kurs'],
    ['/my-products', undefined],
    ['/p/free-tutorial', undefined],
    ['/auth/product-access', undefined],
  ])('%s -> %s', (path, expected) => {
    expect(productSlugHandledByRedirect(path)).toBe(expected);
  });
});
