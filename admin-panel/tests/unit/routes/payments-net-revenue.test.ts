/** The payments API and database agree on retained revenue in original currencies. */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: async () => ({ method: 'session', admin: { userId: 'admin' }, supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, RATE_LIMITS: { ADMIN_ANALYTICS: {} } }));
import { GET } from '@/app/api/v1/payments/stats/route';
import { GET as dashboard } from '@/app/api/v1/analytics/dashboard/route';
import { GET as revenue } from '@/app/api/v1/analytics/revenue/route';
it('counts retained revenue and orders after partial refunds in every period and currency', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const run = randomUUID().replaceAll('-', '');
  const product = await db.from('products').insert({ name: 'Revenue check', slug: `revenue-${run}`, price: 9, currency: 'PLN' }).select('id').single();
  expect(product.error).toBeNull();
  const read = async () => { const response = await GET(new NextRequest('http://localhost/api/v1/payments/stats')); expect(response.status).toBe(200); return (await response.json()).data; };
  try {
    const before = await read();
    const rows = [
      { amount: 900, refunded_amount: 100, currency: 'PLN', status: 'partially_refunded' },
      { amount: 2000, refunded_amount: 0, currency: 'PLN', status: 'completed' },
      { amount: 800, refunded_amount: 200, currency: 'USD', status: 'partially_refunded' },
      { amount: 1000, refunded_amount: 1000, currency: 'PLN', status: 'refunded' },
    ].map((row, index) => ({ ...row, product_id: product.data!.id, customer_email: 'revenue@example.com', session_id: `cs_revenue_${run}_${index}` }));
    expect((await db.from('payment_transactions').insert(rows)).error).toBeNull();
    const after = await read();
    expect(after.total_transactions - before.total_transactions).toBe(3);
    for (const period of ['total', 'today', 'this_month']) {
      const key = `${period}_revenue_by_currency`;
      expect(after[key].PLN - (before[key].PLN ?? 0)).toBe(2800);
      expect(after[key].USD - (before[key].USD ?? 0)).toBe(600);
    }
    expect(after.by_currency.PLN.transaction_count - (before.by_currency.PLN?.transaction_count ?? 0)).toBe(2);
    const overview = (await (await dashboard(new NextRequest(`http://localhost/api/v1/analytics/dashboard?product_id=${product.data!.id}`))).json()).data;
    expect(overview.revenue).toMatchObject({ total: 3400, net_revenue: 3400, total_refunded: 1300, by_currency: { PLN: 2800, USD: 600 } });
    expect(overview.transactions.total).toBe(3);
    const detail = (await (await revenue(new NextRequest(`http://localhost/api/v1/analytics/revenue?period=all&product_id=${product.data!.id}`))).json()).data;
    expect(detail.summary).toMatchObject({ total_revenue: 3400, net_revenue: 3400, total_refunded: 1300, total_transactions: 3 });
    expect(detail.summary.by_currency.PLN).toEqual({ revenue: 2800, transactions: 2, refunded: 1100 });

  } finally {
    await db.from('payment_transactions').delete().eq('product_id', product.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
  }
});
