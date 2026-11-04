/**
 * GET /api/admin/orders — unified orders list for the Payments page "Orders" tab:
 * paid orders, bank transfers, free claims, manual grants, subscriptions and lead sign-ups.
 * Query: type (all|paid|transfer|free|manual|subscription|lead|other), status, search
 * (email / order no.), limit (1–100, default 50), cursor (from the previous page's nextCursor).
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
import { quoteForPostgrestOr } from '@/lib/api/filters';
import { buildSearchPattern, parseOrderNumberQuery } from '@/lib/payments/search';
import { ACCESS_SOURCES_BY_TYPE, ORDER_TYPES, PAYMENT_GRANT_SOURCES, decodeOrdersCursor, isAfterCursor, mergeOrders, pageOrders } from '@/lib/orders/merge';
import type { OrderProductInfo, OrdersCursor } from '@/lib/orders/merge';

const PAYMENT_STATUSES = ['completed', 'awaiting_payment', 'pending', 'refunded', 'partially_refunded', 'disputed', 'cancelled', 'abandoned'];

const querySchema = z.object({
  type: z.enum(['all', ...ORDER_TYPES]).default('all'),
  status: z.enum(['all', 'active', 'expired', 'confirmed', ...PAYMENT_STATUSES]).default('all'),
  search: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(400).optional(),
});

/** Rows strictly older than the cursor (timestamp ≤ cursor, same-timestamp ties removed after merge). */
function olderThan<Q extends { lte: (column: string, value: string) => Q }>(query: Q, column: string, cursor: OrdersCursor | null): Q {
  return cursor ? query.lte(column, cursor.createdAt) : query;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAdminApi(await createClient(), request);
    userId = auth.user.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message === 'Unauthorized' ? 'Unauthorized' : 'Forbidden' }, { status: message === 'Unauthorized' ? 401 : 403 });
  }
  if (!(await checkRateLimit('admin_orders_list', 120, 60, userId))) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  const { type, status, search, limit } = parsed.data;
  const cursor = parsed.data.cursor ? decodeOrdersCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });

  const fetchSize = limit + 1;
  const orderNumber = parseOrderNumberQuery(search);
  const searchPattern = search && orderNumber === null ? buildSearchPattern(search) : null;
  const isPaymentStatus = PAYMENT_STATUSES.includes(status);
  const wantsTransactions = (type === 'all' || type === 'paid' || type === 'transfer') && (status === 'all' || isPaymentStatus);
  const accessSources = type === 'all' ? Object.values(ACCESS_SOURCES_BY_TYPE).flat() : ACCESS_SOURCES_BY_TYPE[type] ?? [];
  const wantsAccesses = accessSources.length > 0 && orderNumber === null && ['all', 'active', 'expired'].includes(status);
  const wantsLeads = (type === 'all' || type === 'lead') && orderNumber === null && ['all', 'confirmed', 'pending'].includes(status);

  try {
    const db = createAdminClient();

    // Search matches the buyer's e-mail or the product (same semantics as the transactions list).
    // Access rows carry no e-mail, so matching users are resolved first.
    let searchUserIds: string[] = [];
    let searchProductIds: string[] = [];
    if (searchPattern) {
      const quoted = quoteForPostgrestOr(searchPattern);
      const [usersRes, productsRes] = await Promise.all([
        wantsAccesses ? db.from('user_access_stats').select('user_id').filter('email', 'imatch', searchPattern).limit(500) : Promise.resolve({ data: [], error: null }),
        db.from('products').select('id').or(`name.imatch.${quoted},slug.imatch.${quoted}`).limit(500),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (productsRes.error) throw productsRes.error;
      searchUserIds = (usersRes.data ?? []).map(row => row.user_id).filter((id): id is string => Boolean(id));
      searchProductIds = (productsRes.data ?? []).map(row => row.id);
    }
    const searchFilter = (emailColumn: string | null, ids: { column: string; values: string[] }[]) => {
      const clauses = emailColumn ? [`${emailColumn}.imatch.${quoteForPostgrestOr(searchPattern!)}`] : [];
      for (const { column, values } of ids) if (values.length) clauses.push(`${column}.in.(${values.join(',')})`);
      return clauses.join(',');
    };

    const loadTransactions = async () => {
      if (!wantsTransactions) return [];
      let query = db.from('payment_transactions')
        .select('id,order_number,customer_email,user_id,product_id,amount,currency,status,payment_provider,created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(fetchSize);
      if (type === 'transfer') query = query.eq('payment_provider', 'bank_transfer');
      if (type === 'paid') query = query.or('payment_provider.is.null,payment_provider.neq.bank_transfer');
      if (isPaymentStatus) query = query.eq('status', status);
      if (orderNumber !== null) query = query.eq('order_number', orderNumber);
      if (searchPattern) query = query.or(searchFilter('customer_email', [{ column: 'product_id', values: searchProductIds }]));
      const { data, error } = await olderThan(query, 'created_at', cursor);
      if (error) throw error;
      return data ?? [];
    };
    const loadAccesses = async () => {
      if (!wantsAccesses || (searchPattern && !searchUserIds.length && !searchProductIds.length)) return [];
      let query = db.from('user_product_access')
        .select('id,user_id,product_id,access_granted_at,access_expires_at,grant_source')
        .in('grant_source', accessSources)
        .not('grant_source', 'in', `(${PAYMENT_GRANT_SOURCES.join(',')})`)
        .order('access_granted_at', { ascending: false }).order('id', { ascending: false }).limit(fetchSize);
      const nowIso = new Date().toISOString();
      if (status === 'active') query = query.or(`access_expires_at.is.null,access_expires_at.gt.${nowIso}`);
      if (status === 'expired') query = query.lte('access_expires_at', nowIso);
      if (searchPattern) query = query.or(searchFilter(null, [{ column: 'user_id', values: searchUserIds }, { column: 'product_id', values: searchProductIds }]));
      const { data, error } = await olderThan(query, 'access_granted_at', cursor);
      if (error) throw error;
      return data ?? [];
    };
    const loadLeads = async () => {
      if (!wantsLeads) return [];
      let query = db.from('lead_submissions').select('id,email,product_id,confirmed_at,created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(fetchSize);
      if (status === 'confirmed') query = query.not('confirmed_at', 'is', null);
      if (status === 'pending') query = query.is('confirmed_at', null);
      if (searchPattern) query = query.or(searchFilter('email', [{ column: 'product_id', values: searchProductIds }]));
      const { data, error } = await olderThan(query, 'created_at', cursor);
      if (error) throw error;
      return data ?? [];
    };

    const [transactions, accesses, leads] = await Promise.all([loadTransactions(), loadAccesses(), loadLeads()]);

    const productIds = [...new Set([...transactions, ...accesses, ...leads].map(r => r.product_id).filter((id): id is string => Boolean(id)))];
    const userIds = [...new Set([...accesses.map(a => a.user_id), ...transactions.filter(t => !t.customer_email && t.user_id).map(t => t.user_id as string)])];
    const [productsRes, emailsRes] = await Promise.all([
      productIds.length ? db.from('products').select('id,name,slug').in('id', productIds) : Promise.resolve({ data: [], error: null }),
      userIds.length ? db.from('user_access_stats').select('user_id,email').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (productsRes.error) throw productsRes.error;
    if (emailsRes.error) throw emailsRes.error;

    const products = new Map<string, OrderProductInfo>((productsRes.data ?? []).map(p => [p.id, { name: p.name, slug: p.slug }]));
    const emails = new Map<string, string>();
    for (const row of emailsRes.data ?? []) if (row.user_id && row.email) emails.set(row.user_id, row.email);

    const merged = mergeOrders({ transactions, accesses, leads, products, emails }).filter(row => isAfterCursor(row, cursor));
    const { page, nextCursor } = pageOrders(merged, limit);
    return NextResponse.json({ orders: page, nextCursor }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[GET /api/admin/orders] Error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}
