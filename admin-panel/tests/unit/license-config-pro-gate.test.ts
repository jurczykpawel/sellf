import { describe, it, expect, vi, beforeEach } from 'vitest';

const SELLER = '44444444-4444-4444-4444-444444444444';

vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminAuth: vi.fn(async (fn: (ctx: { user: { id: string } }) => unknown) =>
    fn({ user: { id: SELLER } }),
  ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('@/lib/license-keys/keys', () => ({
  generateSellerKeypair: vi.fn(),
  importSellerKey: vi.fn(),
  publicFromPrivate: vi.fn(),
  storeSellerKey: vi.fn(),
  loadActivePublicKeyInfo: vi.fn(),
}));

vi.mock('@/lib/license/resolve', () => ({
  checkFeature: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { checkFeature } from '@/lib/license/resolve';
import {
  generateSellerLicenseKey,
  uploadSellerLicenseKey,
  setProductLicenseConfig,
} from '@/lib/actions/license-config';

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nPRIV\n-----END PRIVATE KEY-----\n';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateSellerLicenseKey — pro gate', () => {
  it('returns FORBIDDEN when license-key-issuance feature is not available', async () => {
    vi.mocked(checkFeature).mockResolvedValue(false);
    const res = await generateSellerLicenseKey();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });
});

describe('uploadSellerLicenseKey — pro gate', () => {
  it('returns FORBIDDEN when license-key-issuance feature is not available', async () => {
    vi.mocked(checkFeature).mockResolvedValue(false);
    const res = await uploadSellerLicenseKey(PRIVATE_KEY);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });
});

describe('setProductLicenseConfig — pro gate', () => {
  it('returns FORBIDDEN when enabling issuance and feature not available', async () => {
    vi.mocked(checkFeature).mockResolvedValue(false);
    const res = await setProductLicenseConfig('prod-1', { enabled: true, tier: 'pro', durationDays: null });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });

  it('does not call checkFeature when disabling issuance (always allowed)', async () => {
    vi.mocked(checkFeature).mockResolvedValue(false);
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const select = vi.fn(() => Promise.resolve({ data: [{ id: 'prod-1' }], error: null }));
    const eq = vi.fn();
    const builder = { eq, select };
    eq.mockReturnValue(builder);
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn().mockReturnValue({ update: vi.fn(() => builder) }) } as never);

    const res = await setProductLicenseConfig('prod-1', { enabled: false, tier: null, durationDays: null });
    expect(res.success).toBe(true);
    expect(vi.mocked(checkFeature)).not.toHaveBeenCalled();
  });
});
