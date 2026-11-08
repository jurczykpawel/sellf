/** Aggregate payment totals include every order beyond the REST row cap. */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: async () => ({ method: 'session', scopes: ['payments:read', 'analytics:read'], admin: { userId: 'admin' }, supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, RATE_LIMITS: { ADMIN_ANALYTICS: {}, ADMIN_EXPORT: {} } }));
vi.mock('@/lib/license/resolve', () => ({ resolveCurrentTier: async () => 'registered' }));
import { POST } from '@/app/api/v1/payments/export/route';
import { GET } from '@/app/api/v1/payments/stats/route';
import { GET as analyticsDashboard } from '@/app/api/v1/analytics/dashboard/route';
import { GET as revenue } from '@/app/api/v1/analytics/revenue/route';
import { GET as topProducts } from '@/app/api/v1/analytics/top-products/route';
it('includes retained amounts from more than a thousand orders', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const run = randomUUID().replaceAll('-', '');
  const product = await db.from('products').insert({ name: 'Revenue page check', slug: `revenue-page-${run}`, price: 1, currency: 'JPY' }).select('id').single();
  expect(product.error).toBeNull();
  try {
    const read = async () => { const response = await GET(new NextRequest('http://localhost/api/v1/payments/stats')); expect(response.status).toBe(200); return (await response.json()).data; };
    const before = await read();
    const rows = Array.from({ length: 1001 }, (_, index) => ({ product_id: product.data!.id, customer_email: 'revenue@example.com', amount: 2, refunded_amount: 1, currency: 'JPY', status: 'partially_refunded', stripe_payment_intent_id: `pi_page${run}${index}`, session_id: `cs_page_${run}_${index}` }));
    expect((await db.from('payment_transactions').insert(rows)).error).toBeNull();
    const after = await read();
    expect(after.total_revenue_by_currency.JPY - (before.total_revenue_by_currency.JPY ?? 0)).toBe(1001);
    expect(after.today_revenue_by_currency.JPY - (before.today_revenue_by_currency.JPY ?? 0)).toBe(1001);
    expect(after.this_month_revenue_by_currency.JPY - (before.this_month_revenue_by_currency.JPY ?? 0)).toBe(1001);
    const dashboard = await db.rpc('get_detailed_revenue_stats', { p_product_id: product.data!.id });
    expect(dashboard.error).toBeNull();
    expect((dashboard.data as { totalRevenue: Record<string, number> }).totalRevenue.JPY).toBe(1001);
    const csv = await POST(new NextRequest('http://localhost/api/v1/payments/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: product.data!.id }) }));
    expect(csv.status).toBe(200);
    const [headers, ...lines] = (await csv.text()).trim().split('\n').map(line => line.split(',').map(value => value.slice(1, -1)));
    expect(lines).toHaveLength(1001);
    const amount = headers.indexOf('Amount (major units)'), refund = headers.indexOf('Refunded Amount (major units)');
    expect(lines.reduce((total, line) => total + Number(line[amount]) - Number(line[refund]), 0)).toBe(1001);
    const dashboardResult = await analyticsDashboard(new NextRequest(`http://localhost/api/v1/analytics/dashboard?product_id=${product.data!.id}`));
    const overview = (await dashboardResult.json()).data;
    expect(overview.revenue.total).toBe(1001);
    expect(overview.revenue.net_revenue).toBe(1001);
    expect(overview.transactions.total).toBe(1001);
    expect(overview.refunds.total_refunded).toBe(1001);
    const revenueResult = await revenue(new NextRequest(`http://localhost/api/v1/analytics/revenue?period=all&product_id=${product.data!.id}`));
    const detail = (await revenueResult.json()).data;
    expect(detail.summary.total_revenue).toBe(1001);
    expect(detail.summary.net_revenue).toBe(1001);
    expect(detail.summary.total_transactions).toBe(1001);
    expect(detail.breakdown.reduce((total: number, row: { revenue: number }) => total + row.revenue, 0)).toBe(1001);
    const productsResult = await topProducts(new NextRequest('http://localhost/api/v1/analytics/top-products?period=all&limit=50'));
    const top = (await productsResult.json()).data.products.find((row: { product_id: string }) => row.product_id === product.data!.id);
    expect(top).toMatchObject({ revenue: 1001, sales_count: 1001 });


  } finally {
    await db.from('payment_transactions').delete().eq('product_id', product.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
  }
});

it('treats an empty optional product filter as all products', async () => {
  const response = await analyticsDashboard(new NextRequest('http://localhost/api/v1/analytics/dashboard?product_id='));
  expect(response.status).toBe(200);
});
