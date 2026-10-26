/**
 * Dashboard reads (charts, revenue, goal, filters) as plain GETs instead of server actions.
 * A server action POSTs to the route the router is navigating to, where it does not exist, and
 * fails before the dashboard unmounts; a fetch goes to a fixed URL and can be aborted.
 * Authorization stays in the wrapped actions; this route only requires an admin session.
 * @see src/lib/api/dashboard-reads.ts
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdminApi } from '@/lib/auth-server';
import { getRevenueGoal, getRevenueStats, getHourlyRevenueStats, getSalesChartData } from '@/lib/actions/analytics';
import { getExchangeRates, getUsedCurrencies } from '@/lib/actions/currency';
import { getMyDefaultCurrency } from '@/lib/actions/shop-config';
import { getProductsList } from '@/lib/actions/products';
import { getDashboardStats } from '@/lib/actions/dashboard';
import { isValidTimezone } from '@/lib/timezone';

const productId = z.uuid().optional();
const isoDate = z.iso.datetime().optional();
const timezone = z.string().max(64).refine(isValidTimezone).optional();
const date = (value?: string) => (value ? new Date(value) : undefined);

const reads = {
  chart: z.object({ days: z.coerce.number().int().min(0).max(3650).default(30), start: isoDate, end: isoDate, productId }),
  hourly: z.object({ productId, timezone }),
  goal: z.object({ productId }),
  stats: z.object({ productId, goalStart: isoDate }),
  rates: z.object({ base: z.string().regex(/^[A-Za-z]{3}$/) }),
  defaultCurrency: z.object({}),
  currencies: z.object({}),
  products: z.object({}),
  overview: z.object({}),
};

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApi(await createClient(), request);
    const { read, ...params } = Object.fromEntries(request.nextUrl.searchParams);
    if (!Object.hasOwn(reads, read)) return fail('INVALID_INPUT', 'Unknown dashboard read', 400);
    const parsed = reads[read as keyof typeof reads].safeParse(params);
    if (!parsed.success) return fail('INVALID_INPUT', 'Invalid dashboard read parameters', 400);
    const q = parsed.data as Record<string, string | number | undefined>;

    const data = await {
      chart: () => getSalesChartData(q.days as number, date(q.start as string), date(q.end as string), q.productId as string),
      hourly: () => getHourlyRevenueStats(q.timezone as string, q.productId as string),
      goal: () => getRevenueGoal(q.productId as string),
      stats: () => getRevenueStats(q.productId as string, date(q.goalStart as string)),
      rates: () => getExchangeRates((q.base as string).toUpperCase()),
      defaultCurrency: () => getMyDefaultCurrency(),
      currencies: () => getUsedCurrencies(),
      products: () => getProductsList(),
      overview: () => getDashboardStats(),
    }[read as keyof typeof reads]();

    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return fail('UNAUTHORIZED', 'Unauthorized', 401);
    if (error instanceof Error && error.message === 'Forbidden') return fail('FORBIDDEN', 'Admin access required', 403);
    console.error('[dashboard-reads] Error:', error instanceof Error ? error.message : 'Unknown error');
    return fail('INTERNAL_ERROR', 'Failed to read dashboard data', 500);
  }
}
