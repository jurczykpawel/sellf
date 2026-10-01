import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth-server', () => ({
  requireAdminApi: vi.fn(),
}));

import { requireAdminApi } from '@/lib/auth-server';
import { POST } from '@/app/api/admin/payments/sessions/[sessionId]/cancel/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/payments/sessions/sess_123/cancel', {
    method: 'POST',
  });
}

function makeParams(sessionId = 'sess_123') {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.mocked(requireAdminApi).mockReset();
});

describe('POST /api/admin/payments/sessions/[sessionId]/cancel', () => {
  it('returns 401 instead of throwing when the caller is not authenticated', async () => {
    vi.mocked(requireAdminApi).mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it('returns 403 instead of throwing when the caller is not an admin', async () => {
    vi.mocked(requireAdminApi).mockRejectedValue(new Error('Forbidden'));
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it('returns the not-implemented stub response for an authenticated admin', async () => {
    vi.mocked(requireAdminApi).mockResolvedValue({} as never);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.sessionId).toBe('sess_123');
  });
});
