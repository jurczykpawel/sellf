/**
 * Asserts that the GET /api/subscriptions handler enforces a per-user
 * rate limit alongside the existing auth check. The mutation routes
 * (cancel/resume) are already gated by SUBSCRIPTION_MUTATION; the read
 * path needs its own bucket so a hijacked-cookie attacker cannot spam
 * the DB query path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/rate-limiting', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/rate-limiting')>();
  return {
    ...real,
    checkRateLimit: vi.fn(),
  };
});

import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { GET } from '@/app/api/subscriptions/route';

beforeEach(() => {
  vi.clearAllMocks();
});

function buildSupabase(opts: { userId: string | null; subscriptions?: unknown[] }) {
  const subs = opts.subscriptions ?? [];
  return {
    auth: {
      getUser: async () => ({
        data: { user: opts.userId ? { id: opts.userId } : null },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: table === 'subscriptions' ? subs : null, error: null }),
        }),
        in: async () => ({ data: [], error: null }),
      }),
    }),
  };
}

describe('GET /api/subscriptions — rate limit', () => {
  it('exposes a SUBSCRIPTION_READ bucket', () => {
    expect(RATE_LIMITS).toHaveProperty('SUBSCRIPTION_READ');
    const bucket = (RATE_LIMITS as unknown as { SUBSCRIPTION_READ: { maxRequests: number; windowMinutes: number; actionType: string } }).SUBSCRIPTION_READ;
    expect(bucket.maxRequests).toBeGreaterThan(0);
    expect(bucket.windowMinutes).toBeGreaterThan(0);
    expect(typeof bucket.actionType).toBe('string');
  });

  it('returns 401 without consulting the rate limiter when unauthenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({ userId: null }) as never,
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('calls checkRateLimit with the user id after auth, then proceeds on allow', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({ userId: 'user-1', subscriptions: [] }) as never,
    );
    (checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const res = await GET();
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    const call = (checkRateLimit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // Last argument must be the user id (per-user bucket, not per-IP).
    expect(call[call.length - 1]).toBe('user-1');
    // ActionType must reference SUBSCRIPTION_READ.
    expect(String(call[0])).toMatch(/subscription/i);
    expect(res.status).toBe(200);
  });

  it('returns 429 when rate limit denies', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({ userId: 'user-2', subscriptions: [] }) as never,
    );
    (checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(429);
  });
});
