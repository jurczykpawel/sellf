/** @see src/app/api/webhooks/stripe/route.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/stripe/server', () => ({ verifyWebhookSignature: mocks.verify, getStripeServer: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin, createPlatformClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.limit, RATE_LIMITS: { STRIPE_WEBHOOK: { maxRequests: 100, windowMinutes: 1, actionType: 'stripe_webhook' } } }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => 'test-signature' }) }));
import { POST } from '@/app/api/webhooks/stripe/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({ id: 'evt_expired', type: 'checkout.session.expired', data: { object: { id: 'cs_test_expired' } } });
});
describe('expired session webhook', () => {
  it('dispatches repeated expiration to a pending-only update', async () => {
    const query = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: object) => void) => resolve({ error: null }) };
    const update = vi.fn(() => query);
    mocks.admin.mockReturnValue({ from: vi.fn(() => ({ update })) });
    for (let i = 0; i < 2; i++) {
      const response = await POST(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
      expect(response.status).toBe(200);
    }
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'abandoned' }));
    expect(query.eq).toHaveBeenCalledWith('session_id', 'cs_test_expired');
    expect(query.eq).toHaveBeenCalledWith('status', 'pending');
  });
  it('returns 500 when expiration cannot be saved', async () => {
    const query = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: object) => void) => resolve({ error: { message: 'temporary' } }) };
    mocks.admin.mockReturnValue({ from: () => ({ update: () => query }) });
    const response = await POST(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(500);
  });
});
