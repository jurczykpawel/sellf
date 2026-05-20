import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/services/checkout', () => ({
  CheckoutService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    validateRequest: vi.fn(),
    getProduct: vi.fn(),
    createCheckoutSession: vi.fn(),
  })),
}));

import { POST } from '@/app/api/create-embedded-checkout/route';
import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';

const baseSupabase = {
  auth: { getUser: async () => ({ data: { user: null } }) },
};

function buildRequest(): NextRequest {
  return new NextRequest('http://localhost/api/create-embedded-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify({ productId: 'p-1', email: 'buyer@example.com' }),
  });
}

const savedBase = process.env.NEXT_PUBLIC_BASE_URL;
const savedSite = process.env.SITE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(baseSupabase as never);
});

afterEach(() => {
  if (savedBase === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = savedBase;
  if (savedSite === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = savedSite;
});

describe('POST /api/create-embedded-checkout — canonical origin gate', () => {
  it('returns 500 when neither NEXT_PUBLIC_BASE_URL nor SITE_URL is set', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.SITE_URL;

    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/canonical origin/i);
  });

  it('does NOT fall back to the client Origin header', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.SITE_URL;

    const res = await POST(buildRequest());
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('attacker.example');
  });
});
