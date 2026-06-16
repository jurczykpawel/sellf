import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkFeature: vi.fn(), trigger: vi.fn() }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: mocks.checkFeature }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: mocks.trigger } }));

import { emitLicenseRevokedWebhooks } from '@/lib/services/license-revoke-webhook-payload';
import type { RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';

const admin = { from: () => ({}) } as never;

function row(id: string, product: string, order: string): RevokedLicenseRow {
  return {
    id, product_id: product, email: 'b@example.com', order_id: order, seller_id: 'seller-1',
    license_domain: null, issuance_source: 'purchase', issued_at: null, expires_at: null,
    revoked_at: '2026-06-16T10:00:00.000Z', products: { name: 'P', slug: 'p', license_tier: 'pro' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkFeature.mockResolvedValue(true);
  mocks.trigger.mockResolvedValue(undefined);
});

describe('emitLicenseRevokedWebhooks', () => {
  it('does nothing (no feature check) when there are no rows', async () => {
    await emitLicenseRevokedWebhooks(admin, [], 'https://sellf.example');
    expect(mocks.checkFeature).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('fires one webhook per revoked row when the Pro feature is active', async () => {
    await emitLicenseRevokedWebhooks(admin, [row('a', 'p1', 'o1'), row('b', 'p2', 'o2')], 'https://sellf.example');
    expect(mocks.checkFeature).toHaveBeenCalledTimes(1);
    expect(mocks.trigger).toHaveBeenCalledTimes(2);
    const [event, payload, , productId] = mocks.trigger.mock.calls[0];
    expect(event).toBe('license.revoked');
    expect(productId).toBe('p1');
    expect(payload.crlUrl).toBe('https://sellf.example/api/licenses/revoked?seller=seller-1');
  });

  it('skips dispatch entirely when the Pro feature is inactive', async () => {
    mocks.checkFeature.mockResolvedValue(false);
    await emitLicenseRevokedWebhooks(admin, [row('a', 'p1', 'o1')], 'https://sellf.example');
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('never throws even if dispatch rejects (refund path must not be redelivered)', async () => {
    mocks.trigger.mockRejectedValue(new Error('boom'));
    await expect(
      emitLicenseRevokedWebhooks(admin, [row('a', 'p1', 'o1')], 'https://sellf.example'),
    ).resolves.toBeUndefined();
  });
});
