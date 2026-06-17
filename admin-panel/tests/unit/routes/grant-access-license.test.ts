/**
 * Unit tests: license issuance in the free-product grant-access route.
 *
 * Verifies that when a free product has issue_license_on_purchase enabled,
 * the grant-access route:
 *   1. Calls issueLicense with a deterministic orderId (free_<userId>_<productId>)
 *   2. Includes the license in the lead.captured webhook payload
 *   3. Fires the webhook even if issueLicense throws (fail-safe)
 *   4. Does NOT call issueLicense when the user already had access
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  checkRateLimit: vi.fn(),
  grantFreeProductAccess: vi.fn(),
  webhookTrigger: vi.fn(),
  trackServerSideConversion: vi.fn(),
  issueLicense: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('@/lib/services/free-product-access', () => ({
  grantFreeProductAccess: mocks.grantFreeProductAccess,
}));

vi.mock('@/lib/services/webhook-service', () => ({
  WebhookService: { trigger: mocks.webhookTrigger },
}));

vi.mock('@/lib/tracking', () => ({
  trackServerSideConversion: mocks.trackServerSideConversion,
}));

vi.mock('@/lib/license-keys/issue', () => ({
  issueLicense: mocks.issueLicense,
}));

import { POST } from '@/app/api/public/products/[slug]/grant-access/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = {
  id: 'prod-free-1',
  name: 'Free Guide',
  slug: 'free-guide',
  price: 0,
  currency: 'USD',
  icon: null,
  is_active: true,
  available_from: null,
  available_until: null,
};

const DOMAIN_FIELD = {
  id: '_sellf_license_domain',
  type: 'domain' as const,
  label: { en: 'License domain', pl: 'Domena licencji' },
  required: true,
  max_length: 253,
};

const PRODUCT_WITH_DOMAIN = {
  ...PRODUCT,
  custom_checkout_fields: [DOMAIN_FIELD],
};

const USER = {
  id: 'user-abc',
  email: 'user@example.com',
};

const LICENSE_RESULT = {
  token: 'header.payload.signature',
  kid: 'kid-1',
  sellerId: 'seller-1',
};

function makeRequest(slug = PRODUCT.slug, body?: unknown): Request {
  return new Request(`http://localhost/api/public/products/${slug}/grant-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeContext(slug = PRODUCT.slug) {
  return { params: Promise.resolve({ slug }) };
}

function makeChain(resolvedValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function setupDefaultMocks(product: unknown = PRODUCT) {
  const adminClient = { from: vi.fn() };
  mocks.createAdminClient.mockReturnValue(adminClient);
  // adminClient is only used for grantFreeProductAccess (mocked) + WebhookService; no real DB calls needed.

  const productChain = makeChain({ data: product, error: null });
  const userClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER }, error: null }) },
    from: vi.fn().mockReturnValue(productChain),
  };
  mocks.createClient.mockResolvedValue(userClient);

  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.webhookTrigger.mockResolvedValue(undefined);
  mocks.trackServerSideConversion.mockResolvedValue(undefined);

  return { adminClient, userClient };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('grant-access route — license issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls issueLicense with a deterministic orderId on new grant', async () => {
    setupDefaultMocks();
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockResolvedValue(LICENSE_RESULT);

    await POST(makeRequest(), makeContext());

    expect(mocks.issueLicense).toHaveBeenCalledWith(
      expect.anything(),
      {
        productId: PRODUCT.id,
        email: USER.email,
        userId: USER.id,
        orderId: `free_${USER.id}_${PRODUCT.id}`,
      },
    );
  });

  it('includes license in the lead.captured webhook payload when issueLicense succeeds', async () => {
    setupDefaultMocks();
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockResolvedValue(LICENSE_RESULT);

    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
    await POST(makeRequest(), makeContext());

    const [, payload] = mocks.webhookTrigger.mock.calls[0];
    expect(payload.license).toMatchObject({
      token: LICENSE_RESULT.token,
      kid: LICENSE_RESULT.kid,
      jwksUrl: expect.stringContaining(LICENSE_RESULT.sellerId),
    });
  });

  it('fires lead.captured without license when issueLicense throws (fail-safe)', async () => {
    setupDefaultMocks();
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockRejectedValue(new Error('key not found'));

    await POST(makeRequest(), makeContext());

    expect(mocks.webhookTrigger).toHaveBeenCalled();
    const [, payload] = mocks.webhookTrigger.mock.calls[0];
    expect(payload.license).toBeUndefined();
  });

  it('fires lead.captured without license when issueLicense returns null (disabled)', async () => {
    setupDefaultMocks();
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockResolvedValue(null);

    await POST(makeRequest(), makeContext());

    expect(mocks.webhookTrigger).toHaveBeenCalled();
    const [, payload] = mocks.webhookTrigger.mock.calls[0];
    expect(payload.license).toBeUndefined();
  });

  it('does NOT call issueLicense when user already had access', async () => {
    setupDefaultMocks();
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: true,
      otoInfo: null,
    });

    await POST(makeRequest(), makeContext());

    expect(mocks.issueLicense).not.toHaveBeenCalled();
    expect(mocks.webhookTrigger).not.toHaveBeenCalled();
  });

  it('forwards valid customFieldValues (license domain) to issueLicense', async () => {
    setupDefaultMocks(PRODUCT_WITH_DOMAIN);
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockResolvedValue(LICENSE_RESULT);

    await POST(
      makeRequest(PRODUCT.slug, { customFieldValues: { _sellf_license_domain: 'client.com' } }),
      makeContext(),
    );

    expect(mocks.issueLicense).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productId: PRODUCT.id,
        customFieldValues: { _sellf_license_domain: 'client.com' },
      }),
    );
  });

  it('returns 400 and does NOT grant when a required custom field is missing', async () => {
    setupDefaultMocks(PRODUCT_WITH_DOMAIN);

    const response = await POST(
      makeRequest(PRODUCT.slug, { customFieldValues: {} }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(mocks.grantFreeProductAccess).not.toHaveBeenCalled();
    expect(mocks.issueLicense).not.toHaveBeenCalled();
  });

  it('returns 400 when a custom field value is invalid (bad domain)', async () => {
    setupDefaultMocks(PRODUCT_WITH_DOMAIN);

    const response = await POST(
      makeRequest(PRODUCT.slug, { customFieldValues: { _sellf_license_domain: 'not a domain!!' } }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    expect(mocks.grantFreeProductAccess).not.toHaveBeenCalled();
  });

  it('does not require custom fields when none are submitted (guest magic-link path)', async () => {
    // Body without customFieldValues must keep working even if the product has a
    // required field — the guest magic-link callback re-calls grant-access with no body.
    setupDefaultMocks(PRODUCT_WITH_DOMAIN);
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockResolvedValue(null);

    const response = await POST(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mocks.grantFreeProductAccess).toHaveBeenCalled();
    expect(mocks.issueLicense).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ customFieldValues: expect.anything() }),
    );
  });

  it('returns 200 even when issueLicense throws', async () => {
    setupDefaultMocks();
    mocks.grantFreeProductAccess.mockResolvedValue({
      accessGranted: true,
      alreadyHadAccess: false,
      otoInfo: null,
    });
    mocks.issueLicense.mockRejectedValue(new Error('signing failure'));

    const response = await POST(makeRequest(), makeContext());

    expect(response.status).toBe(200);
  });
});
