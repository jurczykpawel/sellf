import { describe, expect, it } from 'vitest';

import { buildLicenseRevokeWebhookData, type RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';

const row: RevokedLicenseRow = {
  id: 'lic-1',
  product_id: 'prod-1',
  email: 'buyer@example.com',
  order_id: 'cs_test_123',
  seller_id: 'seller-1',
  original_seller_id: 'seller-1',
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
        orderId: null,
        orderNumber: null,
        revocationReason: null,
      },
      revocationReason: null,
      product: { id: 'prod-1', name: 'Premium Plugin', slug: 'premium-plugin' },
      crlUrl: 'https://sellf.example/api/licenses/revoked?seller=seller-1',
    });
  });

  it('omits the signed token from notification metadata', () => {
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

describe('W152 contract additions', () => {
  it('carries the Sellf order identity next to the raw order claim and the revocation reason', () => {
    const data = buildLicenseRevokeWebhookData(
      { ...row, order_id: 'pi_abc', sellf_order_id: 'tx-1', order_number: 1515, revocation_reason: 'refund' },
      'https://sellf.example',
    );
    expect(data.license).toMatchObject({ order: 'pi_abc', orderId: 'tx-1', orderNumber: 1515, revocationReason: 'refund' });
    expect(data.revocationReason).toBe('refund');
  });
  it('reports null identity and reason for rows captured before the fields existed', () => {
    const data = buildLicenseRevokeWebhookData({ ...row, revoked_at: null }, 'https://sellf.example');
    expect(data.license).toMatchObject({ orderId: null, orderNumber: null, revocationReason: null });
    expect(data.revocationReason).toBeNull();
  });
});
