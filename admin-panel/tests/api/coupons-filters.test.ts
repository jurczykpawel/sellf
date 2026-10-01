/**
 * API Integration Tests: Coupons list filters
 *
 * Covers the `type` filter (OTO-auto-generated vs. seller-created coupons)
 * added to back the admin coupons page's server-side paging, plus a
 * regression check that `search` treats literal `%`/`_` as plain characters
 * rather than SQL wildcards, and that pagination still works while a filter
 * is applied.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { get, post, cleanup, deleteTestApiKey, supabase } from './setup';

interface Coupon {
  id: string;
  code: string;
  name?: string;
  is_oto_coupon: boolean;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

const uniqueCode = () => `FILT-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

// The API deliberately has no way to set `is_oto_coupon` via POST/PATCH — it
// is only ever set by the OTO system's own DB functions. Insert directly for
// tests that need an OTO-flagged row.
async function insertOtoCoupon(overrides: Record<string, unknown> = {}): Promise<Coupon> {
  const { data, error } = await supabase
    .from('coupons')
    .insert({
      code: uniqueCode(),
      discount_type: 'percentage',
      discount_value: 10,
      is_oto_coupon: true,
      ...overrides,
    })
    .select('id, code, name, is_oto_coupon, discount_type, discount_value')
    .single();
  if (error) throw error;
  return data as Coupon;
}

describe('GET /api/v1/coupons — type filter', () => {
  const createdCouponIds: string[] = [];
  const otoCouponIds: string[] = [];

  afterAll(async () => {
    await cleanup({ coupons: createdCouponIds });
    if (otoCouponIds.length) {
      await supabase.from('coupons').delete().in('id', otoCouponIds);
    }
    await deleteTestApiKey();
  });

  it('rejects an invalid type value', async () => {
    const { status, data } = await get<ApiResponse<Coupon[]>>('/api/v1/coupons?type=bogus');
    expect(status).toBe(400);
    expect(data.error!.code).toBe('INVALID_INPUT');
  });

  // Both coupons share a search prefix so `search` alone can't distinguish
  // them — only the `type` filter can. This is what actually exercises the
  // filter: narrowing `search` to just one coupon's own code would pass
  // whether or not `type` did anything.
  it('type=oto returns only auto-generated coupons that also match search', async () => {
    const prefix = `SHAREDTYPE${Date.now()}`;
    const regularResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
      code: `${prefix}-REG`,
      discount_type: 'percentage',
      discount_value: 10,
    });
    createdCouponIds.push(regularResult.data.data!.id);

    const otoCoupon = await insertOtoCoupon({ code: `${prefix}-OTO` });
    otoCouponIds.push(otoCoupon.id);

    const { status, data } = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?type=oto&search=${prefix}`
    );

    expect(status).toBe(200);
    const ids = data.data!.map((c) => c.id);
    expect(ids).toContain(otoCoupon.id);
    expect(ids).not.toContain(regularResult.data.data!.id);
    for (const coupon of data.data!) {
      expect(coupon.is_oto_coupon).toBe(true);
    }
  });

  it('type=regular excludes auto-generated coupons that also match search', async () => {
    const prefix = `SHAREDTYPE${Date.now()}`;
    const otoCoupon = await insertOtoCoupon({ code: `${prefix}-OTO` });
    otoCouponIds.push(otoCoupon.id);

    const regularResult = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
      code: `${prefix}-REG`,
      discount_type: 'percentage',
      discount_value: 10,
    });
    createdCouponIds.push(regularResult.data.data!.id);

    const { status, data } = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?type=regular&search=${prefix}`
    );

    expect(status).toBe(200);
    const ids = data.data!.map((c) => c.id);
    expect(ids).toContain(regularResult.data.data!.id);
    expect(ids).not.toContain(otoCoupon.id);
    for (const coupon of data.data!) {
      expect(coupon.is_oto_coupon).toBe(false);
    }
  });

  it('paginates while the type filter is applied', async () => {
    const prefix = `PAGEOTO${Date.now()}`;
    const inserted = await Promise.all([
      insertOtoCoupon({ code: `${prefix}-A` }),
      insertOtoCoupon({ code: `${prefix}-B` }),
    ]);
    otoCouponIds.push(...inserted.map((c) => c.id));

    const firstPage = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?type=oto&search=${prefix}&limit=1`
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.data.data!.length).toBe(1);
    expect(firstPage.data.pagination?.has_more).toBe(true);
    expect(firstPage.data.pagination?.next_cursor).toBeTruthy();

    const secondPage = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?type=oto&search=${prefix}&limit=1&cursor=${firstPage.data.pagination!.next_cursor}`
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.data.data!.length).toBe(1);
    expect(secondPage.data.data![0].id).not.toBe(firstPage.data.data![0].id);
    expect(secondPage.data.data![0].is_oto_coupon).toBe(true);
  });
});

describe('GET /api/v1/coupons — search treats % and _ literally', () => {
  const createdCouponIds: string[] = [];

  afterAll(async () => {
    await cleanup({ coupons: createdCouponIds });
    await deleteTestApiKey();
  });

  it('matches a literal underscore, not "any single character"', async () => {
    const suffix = Date.now();
    // If `_` were passed through unescaped to ILIKE, it matches any single
    // character — the decoy name below would then also match the needle's
    // search term even though it never contains an underscore.
    const needleName = `LIT_TARGET_${suffix}`;
    const decoyName = `LITXTARGETX${suffix}`;

    const needle = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
      code: uniqueCode(),
      name: needleName,
      discount_type: 'percentage',
      discount_value: 10,
    });
    createdCouponIds.push(needle.data.data!.id);

    const decoy = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
      code: uniqueCode(),
      name: decoyName,
      discount_type: 'percentage',
      discount_value: 10,
    });
    createdCouponIds.push(decoy.data.data!.id);

    const { status, data } = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?search=${encodeURIComponent(needleName)}`
    );

    expect(status).toBe(200);
    const ids = data.data!.map((c) => c.id);
    expect(ids).toContain(needle.data.data!.id);
    expect(ids).not.toContain(decoy.data.data!.id);
  });

  it('matches a literal percent sign, not "any sequence of characters"', async () => {
    const suffix = Date.now();
    // If `%` were passed through unescaped to ILIKE, it matches any sequence
    // of characters — the decoy name below would then also match even though
    // it never contains a percent sign.
    const needleName = `50%OFF${suffix}`;
    const decoyName = `50XXXXOFF${suffix}`;

    const needle = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
      code: uniqueCode(),
      name: needleName,
      discount_type: 'percentage',
      discount_value: 10,
    });
    createdCouponIds.push(needle.data.data!.id);

    const decoy = await post<ApiResponse<Coupon>>('/api/v1/coupons', {
      code: uniqueCode(),
      name: decoyName,
      discount_type: 'percentage',
      discount_value: 10,
    });
    createdCouponIds.push(decoy.data.data!.id);

    const { status, data } = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?search=${encodeURIComponent(needleName)}`
    );

    expect(status).toBe(200);
    const ids = data.data!.map((c) => c.id);
    expect(ids).toContain(needle.data.data!.id);
    expect(ids).not.toContain(decoy.data.data!.id);
  });

  it('rejects a search string over 200 characters', async () => {
    const tooLong = 'a'.repeat(201);
    const { status, data } = await get<ApiResponse<Coupon[]>>(
      `/api/v1/coupons?search=${tooLong}`
    );
    expect(status).toBe(400);
    expect(data.error!.code).toBe('INVALID_INPUT');
  });
});
