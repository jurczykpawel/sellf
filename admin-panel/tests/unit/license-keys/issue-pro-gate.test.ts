import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/license/resolve', () => ({
  checkFeature: vi.fn(),
}));

vi.mock('@/lib/license-keys/keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/license-keys/keys')>('@/lib/license-keys/keys');
  return { ...actual, loadActiveSellerKey: vi.fn() };
});

import { checkFeature } from '@/lib/license/resolve';
import { loadActiveSellerKey, generateSellerKeypair } from '@/lib/license-keys/keys';
import { issueLicense } from '@/lib/license-keys/issue';

const SELLER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date(1_000_000 * 1000);
const key = generateSellerKeypair();

interface ProductRow {
  seller_id: string;
  slug: string;
  issue_license_on_purchase: boolean;
  license_tier: string | null;
  license_duration_days: number | null;
}

function makeAdmin(product: ProductRow | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  let licenseQueryCount = 0;
  const from = vi.fn((table: string) => {
    if (table === 'products') {
      const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: product, error: null }) };
      return c;
    }
    const c = {
      select: () => c,
      eq: () => c,
      maybeSingle: () => {
        licenseQueryCount++;
        return Promise.resolve({ data: null, error: null });
      },
      insert,
    };
    return c;
  });
  return { from };
}

const prodRow: ProductRow = {
  seller_id: SELLER,
  slug: 'pro-kit',
  issue_license_on_purchase: true,
  license_tier: 'pro',
  license_duration_days: null,
};

const call = (admin: ReturnType<typeof makeAdmin>) =>
  issueLicense(admin as never, { productId: PRODUCT, email: 'a@b.co', userId: null, orderId: 'ord_new' }, { now: NOW });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadActiveSellerKey).mockResolvedValue({
    kid: key.kid,
    publicKeyPem: key.publicKeyPem,
    privateKeyPem: key.privateKeyPem,
  });
});

describe('issueLicense — pro gate', () => {
  it('returns null silently when license-key-issuance feature is not available', async () => {
    vi.mocked(checkFeature).mockResolvedValue(false);
    const result = await call(makeAdmin(prodRow));
    expect(result).toBeNull();
    expect(vi.mocked(loadActiveSellerKey)).not.toHaveBeenCalled();
  });

  it('proceeds to issue when license-key-issuance feature is available', async () => {
    vi.mocked(checkFeature).mockResolvedValue(true);
    const result = await call(makeAdmin(prodRow));
    expect(result).not.toBeNull();
    expect(result?.token).toBeTruthy();
  });

  it('passes the admin client as dataClient to checkFeature', async () => {
    vi.mocked(checkFeature).mockResolvedValue(false);
    const admin = makeAdmin(prodRow);
    await call(admin);
    expect(vi.mocked(checkFeature)).toHaveBeenCalledWith(
      'license-key-issuance',
      expect.objectContaining({ dataClient: admin }),
    );
  });
});
