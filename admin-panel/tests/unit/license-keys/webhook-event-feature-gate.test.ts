import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkFeature: vi.fn() }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: mocks.checkFeature }));

import { findDeniedEventFeature } from '@/lib/webhooks/event-feature-gate';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findDeniedEventFeature', () => {
  it('allows free events without any feature check', async () => {
    const denial = await findDeniedEventFeature(['purchase.completed', 'refund.issued']);
    expect(denial).toBeNull();
    expect(mocks.checkFeature).not.toHaveBeenCalled();
  });

  it('denies license.revoked when the Pro feature is inactive', async () => {
    mocks.checkFeature.mockResolvedValue(false);
    const denial = await findDeniedEventFeature(['purchase.completed', 'license.revoked']);
    expect(denial).toEqual({ event: 'license.revoked', feature: 'license-revoked-webhook' });
    expect(mocks.checkFeature).toHaveBeenCalledWith('license-revoked-webhook', undefined);
  });

  it('allows license.revoked when the Pro feature is active', async () => {
    mocks.checkFeature.mockResolvedValue(true);
    const denial = await findDeniedEventFeature(['license.revoked'], { from: () => ({}) });
    expect(denial).toBeNull();
    expect(mocks.checkFeature).toHaveBeenCalledWith('license-revoked-webhook', { dataClient: expect.anything() });
  });
});
