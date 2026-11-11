/**
 * Unified admin orders list: paid orders, bank transfers, free claims, manual grants,
 * subscriptions and lead sign-ups (demo feedback 2026-10-29 #12).
 * Pure — the route loads rows, this classifies, merges and pages.
 * Access rows are classified by their recorded `grant_source` (never by product price);
 * rows that a payment already explains (purchase / bundle / bank_transfer) are not loaded.
 * @see src/app/api/admin/orders/route.ts
 * @see supabase/migrations/20261110235904_release_2026_11_0_fulfillment.sql
 */
export type OrderType = 'paid' | 'transfer' | 'free' | 'manual' | 'subscription' | 'lead' | 'other';
export const ORDER_TYPES: readonly OrderType[] = ['paid', 'transfer', 'free', 'manual', 'subscription', 'lead', 'other'];

/** Grant sources whose access row is already represented by its payment transaction. */
export const PAYMENT_GRANT_SOURCES = ['purchase', 'bundle', 'bank_transfer'] as const;
/** Grant sources listed as their own orders, per order type. */
export const ACCESS_SOURCES_BY_TYPE: Partial<Record<OrderType, string[]>> = {
  free: ['free'], manual: ['manual'], subscription: ['subscription'], other: ['unknown'],
};
const TYPE_BY_SOURCE: Record<string, OrderType> = { free: 'free', manual: 'manual', subscription: 'subscription', purchase: 'paid', bundle: 'paid', bank_transfer: 'transfer' };

export interface OrderTransactionRow {
  id: string; order_number: number | null; customer_email: string | null; user_id: string | null;
  product_id: string; amount: number; currency: string; status: string;
  payment_provider: string | null; created_at: string;
}
export interface OrderAccessRow {
  id: string; user_id: string; product_id: string; access_granted_at: string;
  access_expires_at: string | null; grant_source: string;
}
export interface OrderLeadRow {
  id: string; email: string; product_id: string | null; confirmed_at: string | null; created_at: string;
}
export interface OrderProductInfo { name: string; slug: string }

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
  now?: Date;
}

/**
 * Microseconds since epoch. Postgres timestamps carry microseconds, which `Date` would drop:
 * two rows inside the same millisecond must still order (and page) exactly as the database does.
 */
export function timestampMicros(value: string): number {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(value);
  if (!match) return Date.parse(value) * 1000;
  const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
  return Date.parse(`${match[1]}${match[3] || 'Z'}`) * 1000 + Number(fraction);
}

/** Newest first; ties broken by id so the order is total (required for cursor paging). */
export function compareOrders(a: Pick<OrderRow, 'createdAt' | 'id'>, b: Pick<OrderRow, 'createdAt' | 'id'>): number {
  const at = timestampMicros(a.createdAt), bt = timestampMicros(b.createdAt);
  return at !== bt ? bt - at : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function mergeOrders({ transactions, accesses, leads, products, emails, now = new Date() }: MergeOrdersInput): OrderRow[] {
  const base = (id: string | null) => {
    const product = id ? products.get(id) : undefined;
    return { productId: id, productName: product?.name ?? null, productSlug: product?.slug ?? null };
  };
  const rows: OrderRow[] = [
    ...transactions.map((t): OrderRow => ({
      id: `tx:${t.id}`, type: t.payment_provider === 'bank_transfer' ? 'transfer' : 'paid', status: t.status,
      createdAt: t.created_at, orderNumber: t.order_number, email: t.customer_email ?? (t.user_id ? emails.get(t.user_id) ?? null : null),
      ...base(t.product_id), amount: t.amount, currency: t.currency, transactionId: t.id,
    })),
    ...accesses.map((a): OrderRow => ({
      id: `access:${a.id}`, type: TYPE_BY_SOURCE[a.grant_source] ?? 'other',
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
  return rows.sort(compareOrders);
}

// ===== Cursor paging =====

export interface OrdersCursor { createdAt: string; id: string }

export function encodeOrdersCursor(cursor: OrdersCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeOrdersCursor(value: string): OrdersCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || parsed.id.length > 80) return null;
    if (parsed.createdAt.length > 40 || Number.isNaN(timestampMicros(parsed.createdAt)) || !/^(tx|access|lead):[0-9a-f-]{1,40}$/i.test(parsed.id)) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

/** Rows strictly after the cursor position in list order. */
export function isAfterCursor(row: Pick<OrderRow, 'createdAt' | 'id'>, cursor: OrdersCursor | null): boolean {
  return !cursor || compareOrders(cursor, row) < 0;
}

/**
 * Takes one page from rows already sorted with `compareOrders`. Each source is loaded with
 * `limit + 1` rows past the cursor, so the union holds the true next `limit` rows.
 */
export function pageOrders<T extends Pick<OrderRow, 'createdAt' | 'id'>>(rows: T[], limit: number): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: rows.length > limit && last ? encodeOrdersCursor({ createdAt: last.createdAt, id: last.id }) : null };
}
