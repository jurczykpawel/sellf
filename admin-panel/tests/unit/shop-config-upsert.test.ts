/**
 * updateShopConfig upsert behaviour.
 *
 * Regression: prod ran migrations only (no seed.sql) → shop_config had 0 rows →
 * the old SELECT→UPDATE path returned "No shop config found" and EVERY settings
 * save (shop name, legal docs, tax) failed. Local/CI never hit this because
 * seed.sql always seeds the row. updateShopConfig must CREATE the singleton row
 * when missing instead of failing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertSingle = vi.fn();
const updateEq = vi.fn();
const maybeSingle = vi.fn();

// Chainable supabase-style client driven by the mocks above.
const dataClient = {
  from: () => ({
    select: () => ({ maybeSingle }),
    insert: () => ({ select: () => ({ single: insertSingle }) }),
    update: () => ({ eq: updateEq }),
  }),
};

vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminClient: vi.fn(async (fn: (ctx: { dataClient: unknown }) => unknown) => fn({ dataClient })),
}));
vi.mock('@/lib/demo-guard', () => ({
  isDemoMode: () => false,
  DEMO_MODE_ERROR: 'demo',
}));
vi.mock('@/lib/redis/cache', () => ({
  cacheDel: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  CacheKeys: { SHOP_CONFIG: 'shop_config' },
  CacheTTL: { LONG: 3600 },
}));
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

describe('updateShopConfig — singleton upsert', () => {
  beforeEach(() => {
    insertSingle.mockReset();
    updateEq.mockReset();
    maybeSingle.mockReset();
  });

  it('CREATES the row when shop_config is empty (fresh install / no seed.sql)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null }); // empty table
    insertSingle.mockResolvedValue({ data: { id: 'new-id' }, error: null });

    const { updateShopConfig } = await import('@/lib/actions/shop-config');
    const ok = await updateShopConfig({ shop_name: 'Fresh Shop' });

    expect(ok).toBe(true);
    expect(insertSingle).toHaveBeenCalledTimes(1); // created, not failed
    expect(updateEq).not.toHaveBeenCalled();
  });

  it('UPDATES the existing row when shop_config already has the singleton', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'existing-id' }, error: null });
    updateEq.mockResolvedValue({ error: null });

    const { updateShopConfig } = await import('@/lib/actions/shop-config');
    const ok = await updateShopConfig({ shop_name: 'Updated Shop' });

    expect(ok).toBe(true);
    expect(updateEq).toHaveBeenCalledTimes(1);
    expect(insertSingle).not.toHaveBeenCalled();
  });

  it('returns false when the read itself errors (not a missing-row case)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection lost' } });

    const { updateShopConfig } = await import('@/lib/actions/shop-config');
    const ok = await updateShopConfig({ shop_name: 'X' });

    expect(ok).toBe(false);
    expect(insertSingle).not.toHaveBeenCalled();
    expect(updateEq).not.toHaveBeenCalled();
  });

  it('rejects an update carrying a column not in the shop config shape', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'existing-id' }, error: null });
    updateEq.mockResolvedValue({ error: null });

    const { updateShopConfig } = await import('@/lib/actions/shop-config');
    const ok = await updateShopConfig({
      shop_name: 'X',
      // @ts-expect-error — deliberately not a ShopConfig column
      is_admin: true,
    });

    expect(ok).toBe(false);
    expect(updateEq).not.toHaveBeenCalled();
    expect(insertSingle).not.toHaveBeenCalled();
  });

  it('accepts a valid checkout_theme', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'existing-id' }, error: null });
    updateEq.mockResolvedValue({ error: null });

    const { updateShopConfig } = await import('@/lib/actions/shop-config');
    for (const theme of ['system', 'light', 'dark', null] as const) {
      expect(await updateShopConfig({ checkout_theme: theme })).toBe(true);
    }
  });

  it('rejects a checkout_theme outside the enum without writing', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'existing-id' }, error: null });
    updateEq.mockResolvedValue({ error: null });

    const { updateShopConfig } = await import('@/lib/actions/shop-config');
    const ok = await updateShopConfig({ checkout_theme: 'purple' as never });

    expect(ok).toBe(false);
    expect(updateEq).not.toHaveBeenCalled();
    expect(insertSingle).not.toHaveBeenCalled();
  });
});
