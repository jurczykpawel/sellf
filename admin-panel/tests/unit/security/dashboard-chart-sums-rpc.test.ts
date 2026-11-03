/**
 * ============================================================================
 * Dashboard chart sums: several payments in one currency on one day
 * ============================================================================
 *
 * `get_sales_chart_data` must report the SUM of all completed payments per
 * currency per day (not just one of them), and `get_hourly_revenue_stats` must
 * bucket hours in the caller's timezone so the chart matches the payments list.
 *
 * All rows live on fixed historic days and are scoped by per-run product ids,
 * so results never depend on the wall clock or the machine timezone.
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20250103000000_features.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TS = Date.now();
const DAY = '2021-05-10';
const NEXT_DAY = '2021-05-11';

let productId: string;
let otherProductId: string;
const createdProductIds: string[] = [];
const createdTransactionIds: string[] = [];

async function createProduct(label: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .schema('public' as any)
    .from('products')
    .insert({ name: `Chart Sum ${label} ${TS}`, slug: `chart-sum-${label}-${TS}`, price: 10, currency: 'PLN', is_active: true })
    .select('id')
    .single();
  if (error) throw error;
  createdProductIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  productId = await createProduct('a');
  otherProductId = await createProduct('b');

  const rows = [
    { n: 'a', product: productId, amount: 1000, currency: 'PLN', status: 'completed', at: `${DAY}T08:10:00Z` },
    { n: 'b', product: productId, amount: 2000, currency: 'PLN', status: 'completed', at: `${DAY}T09:20:00Z` },
    { n: 'c', product: productId, amount: 3000, currency: 'PLN', status: 'completed', at: `${DAY}T21:45:00Z` },
    { n: 'd', product: productId, amount: 500, currency: 'USD', status: 'completed', at: `${DAY}T12:00:00Z` },
    { n: 'e', product: productId, amount: 9999, currency: 'PLN', status: 'pending', at: `${DAY}T10:00:00Z` },
    // 22:30 UTC is 00:30 the next day in Europe/Warsaw (CEST)
    { n: 'g', product: productId, amount: 400, currency: 'PLN', status: 'completed', at: `${DAY}T22:30:00Z` },
    { n: 'f', product: productId, amount: 700, currency: 'PLN', status: 'completed', at: `${NEXT_DAY}T07:00:00Z` },
    { n: 'h', product: otherProductId, amount: 900, currency: 'PLN', status: 'completed', at: `${DAY}T10:00:00Z` },
  ];

  for (const r of rows) {
    const { data, error } = await supabaseAdmin
      .schema('public' as any)
      .from('payment_transactions')
      .insert({
        session_id: `cs_chartsum${r.n}${TS}`,
        stripe_payment_intent_id: `pi_chartsum${r.n}${TS}`,
        product_id: r.product,
        customer_email: `chartsum-${r.n}-${TS}@example.com`,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        created_at: new Date(r.at).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert transaction: ${error.message}`);
    createdTransactionIds.push(data.id);
  }
});

afterAll(async () => {
  for (const id of createdTransactionIds) {
    await supabaseAdmin.schema('public' as any).from('payment_transactions').delete().eq('id', id);
  }
  for (const id of createdProductIds) {
    await supabaseAdmin.schema('public' as any).from('products').delete().eq('id', id);
  }
});

async function chart(args: { start: string; end: string; product?: string; timezone?: string }) {
  const { data, error } = await supabaseAdmin.rpc('get_sales_chart_data', {
    p_start_date: args.start,
    p_end_date: args.end,
    p_product_id: args.product ?? null,
    ...(args.timezone ? { p_timezone: args.timezone } : {}),
  });
  expect(error).toBeNull();
  return data as { date: string; amount_by_currency: Record<string, number>; orders: number }[];
}

describe('get_sales_chart_data sums every payment of the day', () => {
  it('sums same-currency payments per day and keeps other currencies', async () => {
    const rows = await chart({ start: `${DAY}T00:00:00Z`, end: `${NEXT_DAY}T23:59:59Z`, product: productId });

    expect(rows.map((r) => r.date)).toEqual([DAY, NEXT_DAY]);
    expect(Number(rows[0].amount_by_currency.PLN)).toBe(6400);
    expect(Number(rows[0].amount_by_currency.USD)).toBe(500);
    expect(rows[0].orders).toBe(5);
    expect(Number(rows[1].amount_by_currency.PLN)).toBe(700);
    expect(rows[1].orders).toBe(1);
  });

  it('respects the date range', async () => {
    const rows = await chart({ start: `${DAY}T00:00:00Z`, end: `${DAY}T11:00:00Z`, product: productId });

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_by_currency.PLN)).toBe(3000);
    expect(rows[0].amount_by_currency.USD).toBeUndefined();
    expect(rows[0].orders).toBe(2);
  });

  it('sums across products without a product filter', async () => {
    const rows = await chart({ start: `${DAY}T00:00:00Z`, end: `${DAY}T23:59:59Z` });

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_by_currency.PLN)).toBe(7300);
    expect(rows[0].orders).toBe(6);
  });
});

describe('get_sales_chart_data groups days in the seller timezone (W78)', () => {
  it('puts a purchase after local midnight on the local day, not the UTC day', async () => {
    const rows = await chart({ start: `${DAY}T00:00:00Z`, end: `${NEXT_DAY}T23:59:59Z`, product: productId, timezone: 'Europe/Warsaw' });

    expect(rows.map((r) => r.date)).toEqual([DAY, NEXT_DAY]);
    expect(Number(rows[0].amount_by_currency.PLN)).toBe(6000);
    expect(rows[0].orders).toBe(4);
    expect(Number(rows[1].amount_by_currency.PLN)).toBe(1100);
    expect(rows[1].orders).toBe(2);
  });

  it('falls back to UTC days for an unknown timezone', async () => {
    const rows = await chart({ start: `${DAY}T00:00:00Z`, end: `${NEXT_DAY}T23:59:59Z`, product: productId, timezone: 'Not/AZone' });

    expect(Number(rows[0].amount_by_currency.PLN)).toBe(6400);
  });
});

describe('get_hourly_revenue_stats buckets hours in the requested timezone', () => {
  async function hourly(date: string, timezone?: string) {
    const { data, error } = await supabaseAdmin.rpc('get_hourly_revenue_stats', {
      p_target_date: date,
      p_product_id: productId,
      ...(timezone ? { p_timezone: timezone } : {}),
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(24);
    return data as { hour: number; amount_by_currency: Record<string, number>; orders: number }[];
  }

  const filled = (rows: { hour: number; orders: number }[]) => rows.filter((r) => r.orders > 0).map((r) => r.hour);

  it('defaults to UTC hours', async () => {
    const rows = await hourly(DAY);

    expect(filled(rows)).toEqual([8, 9, 12, 21, 22]);
    expect(Number(rows[8].amount_by_currency.PLN)).toBe(1000);
  });

  it('shifts hours and the target day to the given timezone', async () => {
    const day = await hourly(DAY, 'Europe/Warsaw');
    expect(filled(day)).toEqual([10, 11, 14, 23]);
    expect(Number(day[23].amount_by_currency.PLN)).toBe(3000);

    const nextDay = await hourly(NEXT_DAY, 'Europe/Warsaw');
    expect(filled(nextDay)).toEqual([0, 9]);
    expect(Number(nextDay[0].amount_by_currency.PLN)).toBe(400);
  });

  it('falls back to UTC for an unknown timezone', async () => {
    const rows = await hourly(DAY, 'Not/AZone');

    expect(filled(rows)).toEqual([8, 9, 12, 21, 22]);
  });
});
