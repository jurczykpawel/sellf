import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The /api/verify-payment route is publicly reachable and authenticated only by
 * the session_id (which leaks via URL/Referer/history). An anonymous caller must
 * never receive the buyer's email or purchase details — only the authenticated
 * owner (or the server-rendered post-purchase page, which bypasses this route).
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyPaymentSession: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('@/lib/payment/verify-payment', () => ({
  verifyPaymentSession: mocks.verifyPaymentSession,
}));

import { POST } from '@/app/api/verify-payment/route';

function makeRequest(sessionId = 'cs_test_abc123') {
  return new NextRequest('http://localhost/api/verify-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

const FULL_RESULT = {
  session_id: 'cs_test_abc123',
  status: 'complete',
  payment_status: 'paid',
  customer_email: 'buyer@example.com',
  amount_total: 9900,
  currency: 'pln',
  metadata: { product_id: 'prod-123' },
  access_granted: true,
  requires_login: true,
  send_magic_link: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.verifyPaymentSession.mockResolvedValue({ ...FULL_RESULT });
});

describe('POST /api/verify-payment — PII redaction', () => {
  it('redacts email + purchase details for an anonymous caller', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customer_email).toBeUndefined();
    expect(body.amount_total).toBeUndefined();
    expect(body.currency).toBeUndefined();
    expect(body.metadata?.product_id).toBeUndefined();
    // Flow-control fields the post-purchase page needs are still present.
    expect(body.access_granted).toBe(true);
    expect(body.send_magic_link).toBe(true);
  });

  it('returns email to an authenticated caller (the owner)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'buyer@example.com' } } });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customer_email).toBe('buyer@example.com');
    expect(body.amount_total).toBe(9900);
  });
});
