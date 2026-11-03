/**
 * GET /api/admin/orders — unified orders list for the Payments page "Orders" tab:
 * paid orders, bank transfers, free self-claims, manual grants and lead sign-ups.
 * Query: type (all|paid|transfer|free|manual|lead), status, search (email / order no.).
 * Admin only; reads with the service role after the admin check.
 * @see src/lib/orders/merge.ts
 * @see src/components/admin/OrdersTable.tsx
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { escapeIlikePattern } from '@/lib/validations/product';
import { parseOrderNumberQuery } from '@/lib/payments/search';
import { mergeOrders, ORDER_TYPES } from '@/lib/orders/merge';
import type { OrderProductInfo } from '@/lib/orders/merge';

/** Rows read per source; the merged list is cut to the same size. */
const SOURCE_LIMIT = 200;

const querySchema = z.object({
  type: z.enum(['all', ...ORDER_TYPES]).default('all'),
  status: z.string().regex(/^[a-z_]{1,32}$/).default('all'),
  search: z.string().trim().max(200).default(''),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAdminApi(await createClient(), request);
    userId = auth.user.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message === 'Unauthorized' ? 'Unauthorized' : 'Forbidden' }, { status: message === 'Unauthorized' ? 401 : 403 });
  }
  if (!(await checkRateLimit('admin_orders_list', 60, 60, userId))) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  const { type, status, search } = parsed.data;
  const wants = (t: string) => type === 'all' || type === t;
  const orderNumber = parseOrderNumberQuery(search);
  const emailPattern = search && orderNumber === null ? `%${escapeIlikePattern(search)}%` : null;

  try {
    const db = createAdminClient();

    // Users matching the search (for access rows, which carry no email).
    let searchUserIds: string[] | null = null;
    if (emailPattern) {
      const { data, error } = await db.from('user_access_stats').select('user_id').ilike('email', emailPattern).limit(500);
      if (error) throw error;
      searchUserIds = (data ?? []).map(row => row.user_id).filter((id): id is string => Boolean(id));
    }

    const loadTransactions = async () => {
      if (!wants('paid') && !wants('transfer')) return [];
      let query = db.from('payment_transactions')
        .select('id,order_number,customer_email,user_id,product_id,amount,currency,status,payment_provider,created_at')
        .order('created_at', { ascending: false }).limit(SOURCE_LIMIT);
      if (type === 'transfer') query = query.eq('payment_provider', 'bank_transfer');
      if (type === 'paid') query = query.or('payment_provider.is.null,payment_provider.neq.bank_transfer');
      if (orderNumber !== null) query = query.eq('order_number', orderNumber);
      if (emailPattern) query = query.ilike('customer_email', emailPattern);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    };
    const loadAccesses = async () => {
      if ((!wants('free') && !wants('manual')) || orderNumber !== null) return [];
      if (searchUserIds && searchUserIds.length === 0) return [];
      let query = db.from('user_product_access')
        .select('id,user_id,product_id,access_granted_at,access_expires_at,transfer_transaction_id')
        .is('transfer_transaction_id', null)
        .order('access_granted_at', { ascending: false }).limit(SOURCE_LIMIT);
      if (searchUserIds) query = query.in('user_id', searchUserIds);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    };
    const loadLeads = async () => {
      if (!wants('lead') || orderNumber !== null) return [];
      let query = db.from('lead_submissions').select('id,email,product_id,confirmed_at,created_at')
        .order('created_at', { ascending: false }).limit(SOURCE_LIMIT);
      if (emailPattern) query = query.ilike('email', emailPattern);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    };

    const [transactions, accesses, leads] = await Promise.all([loadTransactions(), loadAccesses(), loadLeads()]);

    // Payments that may cover an access row even if older than the transaction window.
    const accessUserIds = [...new Set(accesses.map(a => a.user_id))];
    const coveringTransactions = accessUserIds.length
      ? (await db.from('payment_transactions').select('user_id,product_id').in('user_id', accessUserIds)
          .in('status', ['completed', 'refunded', 'partially_refunded', 'disputed'])).data ?? []
      : [];
    const covered = new Set(coveringTransactions.map(t => `${t.user_id}:${t.product_id}`));
    const uncoveredAccesses = accesses.filter(a => !covered.has(`${a.user_id}:${a.product_id}`));

    const productIds = [...new Set([...transactions, ...uncoveredAccesses, ...leads].map(r => r.product_id).filter((id): id is string => Boolean(id)))];
    const userIds = [...new Set([...uncoveredAccesses.map(a => a.user_id), ...transactions.filter(t => !t.customer_email && t.user_id).map(t => t.user_id as string)])];
    const [productsRes, emailsRes] = await Promise.all([
      productIds.length ? db.from('products').select('id,name,slug,price').in('id', productIds) : Promise.resolve({ data: [], error: null }),
      userIds.length ? db.from('user_access_stats').select('user_id,email').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (productsRes.error) throw productsRes.error;
    if (emailsRes.error) throw emailsRes.error;

    const products = new Map<string, OrderProductInfo>((productsRes.data ?? []).map(p => [p.id, { name: p.name, slug: p.slug, price: p.price }]));
    const emails = new Map<string, string>();
    for (const row of emailsRes.data ?? []) if (row.user_id && row.email) emails.set(row.user_id, row.email);

    const orders = mergeOrders({ transactions, accesses: uncoveredAccesses, leads, products, emails, type, status }).slice(0, SOURCE_LIMIT);
    return NextResponse.json({ orders, limit: SOURCE_LIMIT }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[GET /api/admin/orders] Error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}
