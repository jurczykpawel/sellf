/**
 * Read-only preview for the administrator before accepting a transfer that arrived after the order was cancelled
 * (plan D6, W254): the order price against today's price, seats left in the session, the coupon state and whether
 * the invoice was corrected. Acceptance always honours the order price (the seat may go over the limit).
 * @see components/admin/BankTransferSection.tsx, migration 20261115110000_cancelled_order_no_payment.sql
 */
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type LateCouponStatus = 'valid' | 'expired' | 'exhausted' | 'inactive' | 'deleted';
export interface LateTransferPreview {
  amount: number;
  currency: string;
  unitPrice: number;
  unitPriceToday: number | null;
  priceChanged: boolean;
  seats: { remaining: number | null; quantity: number; oversold: boolean; started: boolean } | null;
  coupon: { code: string | null; status: LateCouponStatus } | null;
  invoiceCorrected: boolean;
}
interface SessionAvailability { id: string; starts_at: string; remaining: number | null; sold_out: boolean; current_tier: { price: number } | null }

export async function previewLateTransfer(db: SupabaseClient<Database>, id: string, now: Date): Promise<LateTransferPreview | null> {
  const { data: tx } = await db.from('payment_transactions').select('id,payment_provider,status,amount,currency,product_id,coupon_id').eq('id', id).single();
  if (!tx || tx.payment_provider !== 'bank_transfer' || tx.status !== 'cancelled' || !tx.product_id) return null;
  const [{ data: lines }, { data: product }, { data: invoice }] = await Promise.all([
    db.from('payment_line_items').select('product_id,item_type,quantity,unit_price,session_id').eq('transaction_id', id),
    db.from('products').select('price,sale_price,sale_price_until,sale_quantity_limit,sale_quantity_sold').eq('id', tx.product_id).maybeSingle(),
    db.from('invoices').select('status').eq('transaction_id', id).maybeSingle(),
  ]);
  const main = (lines ?? []).find(l => l.item_type === 'main_product');
  if (!main) return null;
  const unitPrice = Number(main.unit_price);
  let unitPriceToday: number | null = product ? Number(getEffectiveUnitPrice(product)) : null;
  let seats: LateTransferPreview['seats'] = null;
  if (main.session_id) {
    const { data } = await db.rpc('event_availability', { p_product_id: tx.product_id, p_at: now.toISOString() });
    const session = (data as SessionAvailability[] | null)?.find(s => s.id === main.session_id);
    const remaining = session ? session.remaining : 0;
    unitPriceToday = session?.current_tier ? Number(session.current_tier.price) : null;
    seats = { remaining, quantity: main.quantity, started: !session || Date.parse(session.starts_at) <= now.getTime(),
      oversold: !session || session.sold_out || (remaining !== null && remaining < main.quantity) };
  }
  let coupon: LateTransferPreview['coupon'] = null;
  if (tx.coupon_id) {
    const { data: c } = await db.from('coupons').select('code,is_active,usage_limit_global,current_usage_count,expires_at').eq('id', tx.coupon_id).maybeSingle();
    coupon = !c ? { code: null, status: 'deleted' } : { code: c.code, status: !c.is_active ? 'inactive'
      : c.expires_at && Date.parse(c.expires_at) <= now.getTime() ? 'expired'
      : c.usage_limit_global !== null && (c.current_usage_count ?? 0) >= c.usage_limit_global ? 'exhausted' : 'valid' };
  }
  return { amount: tx.amount, currency: tx.currency, unitPrice, unitPriceToday, priceChanged: unitPriceToday !== unitPrice, seats, coupon,
    invoiceCorrected: invoice?.status === 'corrected' };
}
