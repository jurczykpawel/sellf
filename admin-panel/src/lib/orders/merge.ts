/**
 * Unified admin orders list: paid orders, bank transfers, free self-claims,
 * manual grants and lead sign-ups (demo feedback 2026-10-29 #12).
 * Pure — the route loads rows, this classifies, de-duplicates and filters.
 * A free/manual access is a `user_product_access` row with no payment for the
 * same user+product; free = product price 0, manual = paid product granted by an admin.
 * @see src/app/api/admin/orders/route.ts
 */
export type OrderType = 'paid' | 'transfer' | 'free' | 'manual' | 'lead';
export const ORDER_TYPES: readonly OrderType[] = ['paid', 'transfer', 'free', 'manual', 'lead'];

/** Payment statuses under which the buyer's access row is explained by the payment itself. */
const ACCESS_GRANTING_STATUSES = new Set(['completed', 'refunded', 'partially_refunded', 'disputed']);

export interface OrderTransactionRow {
  id: string; order_number: number | null; customer_email: string | null; user_id: string | null;
  product_id: string; amount: number; currency: string; status: string;
  payment_provider: string | null; created_at: string;
}
export interface OrderAccessRow {
  id: string; user_id: string; product_id: string; access_granted_at: string;
  access_expires_at: string | null; transfer_transaction_id: string | null;
}
export interface OrderLeadRow {
  id: string; email: string; product_id: string | null; confirmed_at: string | null; created_at: string;
}
export interface OrderProductInfo { name: string; slug: string; price: number | null }

export interface OrderRow {
  id: string; type: OrderType; status: string; createdAt: string;
  orderNumber: number | null; email: string | null;
  productId: string | null; productName: string | null; productSlug: string | null;
  amount: number | null; currency: string | null; transactionId: string | null;
}

export interface MergeOrdersInput {
  transactions: OrderTransactionRow[];
  accesses: OrderAccessRow[];
  leads: OrderLeadRow[];
  products: Map<string, OrderProductInfo>;
  emails: Map<string, string>;
  type?: string;
  status?: string;
  now?: Date;
}

export function mergeOrders({ transactions, accesses, leads, products, emails, type, status, now = new Date() }: MergeOrdersInput): OrderRow[] {
  const product = (id: string | null) => (id ? products.get(id) : undefined);
  const base = (id: string | null) => ({ productId: id, productName: product(id)?.name ?? null, productSlug: product(id)?.slug ?? null });
  const paidKeys = new Set(transactions.filter(t => t.user_id && ACCESS_GRANTING_STATUSES.has(t.status)).map(t => `${t.user_id}:${t.product_id}`));

  const rows: OrderRow[] = [
    ...transactions.map((t): OrderRow => ({
      id: `tx:${t.id}`, type: t.payment_provider === 'bank_transfer' ? 'transfer' : 'paid', status: t.status,
      createdAt: t.created_at, orderNumber: t.order_number, email: t.customer_email ?? (t.user_id ? emails.get(t.user_id) ?? null : null),
      ...base(t.product_id), amount: t.amount, currency: t.currency, transactionId: t.id,
    })),
    ...accesses
      .filter(a => !a.transfer_transaction_id && !paidKeys.has(`${a.user_id}:${a.product_id}`))
      .map((a): OrderRow => ({
        id: `access:${a.id}`, type: (product(a.product_id)?.price ?? 0) > 0 ? 'manual' : 'free',
        status: a.access_expires_at && new Date(a.access_expires_at) <= now ? 'expired' : 'active',
        createdAt: a.access_granted_at, orderNumber: null, email: emails.get(a.user_id) ?? null,
        ...base(a.product_id), amount: null, currency: null, transactionId: null,
      })),
    ...leads.map((l): OrderRow => ({
      id: `lead:${l.id}`, type: 'lead', status: l.confirmed_at ? 'confirmed' : 'pending',
      createdAt: l.created_at, orderNumber: null, email: l.email,
      ...base(l.product_id), amount: null, currency: null, transactionId: null,
    })),
  ];

  return rows
    .filter(r => !type || type === 'all' || r.type === type)
    .filter(r => !status || status === 'all' || r.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
