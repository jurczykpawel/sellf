import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regression: the coupons list `search` param must be quoted before being spliced
 * into a PostgREST `.or()` filter, so commas/dots/parentheses in the value cannot
 * inject extra filter clauses (mirrors the hardened products/tags endpoints).
 */

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  orCalls: [] as string[],
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, authenticate: mocks.authenticate };
});

import { GET } from '@/app/api/v1/coupons/route';

function makeRecordingSupabase(orCalls: string[]) {
  const query: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(query, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      }
      return (...args: unknown[]) => {
        if (prop === 'or') orCalls.push(String(args[0]));
        return proxy;
      };
    },
  });
  return {
    from: () => ({ select: () => proxy }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orCalls = [];
  mocks.authenticate.mockResolvedValue({ supabase: makeRecordingSupabase(mocks.orCalls) });
});

describe('GET /api/v1/coupons — search filter injection', () => {
  it('quotes the search value so it cannot inject extra .or() clauses', async () => {
    // Comma + dots are the PostgREST .or() clause separators; no ILIKE wildcards
    // here so the value passes through escapeIlikePattern unchanged.
    const malicious = 'x,price.gt.0';
    const req = new NextRequest(
      `http://localhost/api/v1/coupons?search=${encodeURIComponent(malicious)}`,
    );

    const res = await GET(req);
    expect(res.status).toBe(200);

    // Exactly one .or() was issued (the search one — status defaulted to 'all').
    expect(mocks.orCalls).toHaveLength(1);
    const orArg = mocks.orCalls[0];

    // The whole value is wrapped in double quotes, so the comma/dots are inert as
    // filter syntax. Pre-fix the arg was `code.ilike.%x,price.gt.0%,name.ilike...`
    // where PostgREST would parse `price.gt.0` as its own clause.
    expect(orArg).toContain('code.ilike."%x,price.gt.0%"');
    expect(orArg).toContain('name.ilike."%x,price.gt.0%"');
  });
});
