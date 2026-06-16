import { describe, expect, it } from 'vitest';

import { buildLicenseRevokeWebhookData, type RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';

const row: RevokedLicenseRow = {
  id: 'lic-1',
  product_id: 'prod-1',
  email: 'buyer@example.com',
  order_id: 'cs_test_123',
  seller_id: 'seller-1',
  license_domain: 'buyer.example.com',
  issuance_source: 'purchase',
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2027-01-01T00:00:00.000Z',
  revoked_at: '2026-06-16T10:00:00.000Z',
  products: { name: 'Premium Plugin', slug: 'premium-plugin', license_tier: 'pro' },
};

describe('buildLicenseRevokeWebhookData', () => {
  it('maps a revoked license row to the webhook envelope data', () => {
    const data = buildLicenseRevokeWebhookData(row, 'https://sellf.example');
    expect(data).toEqual({
      license: {
        id: 'lic-1',
        order: 'cs_test_123',
        email: 'buyer@example.com',
        tier: 'pro',
        domain: 'buyer.example.com',
        issuanceSource: 'purchase',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        revokedAt: '2026-06-16T10:00:00.000Z',
      },
      product: { id: 'prod-1', name: 'Premium Plugin', slug: 'premium-plugin' },
      crlUrl: 'https://sellf.example/api/licenses/revoked?seller=seller-1',
    });
  });

  it('never leaks the signed token even if a row carries it', () => {
    const dirty = { ...row, license_key: 'payload.signature' } as RevokedLicenseRow;
    const data = buildLicenseRevokeWebhookData(dirty, 'https://sellf.example');
    expect(JSON.stringify(data)).not.toContain('payload.signature');
  });

  it('tolerates a missing product join and nullable fields', () => {
    const data = buildLicenseRevokeWebhookData(
      { ...row, license_domain: null, expires_at: null, products: null },
      'https://sellf.example',
    );
    expect(data.license.domain).toBeNull();
    expect(data.license.expiresAt).toBeNull();
    expect(data.license.tier).toBeNull();
    expect(data.product).toEqual({ id: 'prod-1', name: null, slug: null });
  });
});
