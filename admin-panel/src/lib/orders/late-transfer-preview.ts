/**
 * Read-only preview for the administrator before accepting a transfer that arrived after the order was cancelled
 * the order price against today's price, seats left in the session and in the order's saved price tier,
 * the coupon state and whether the invoice was corrected. Acceptance always honours the order price; going over a seat
 * limit needs the administrator's explicit confirmation. The seat facts come from event_order_seats, the same
 * rule the acceptance applies, so the preview cannot say "free" when acceptance would go over a limit.
 * @see components/admin/BankTransferSection.tsx, app/api/v1/payments/[id]/late-transfer-preview/route.ts,
 *   migration 20261115110000_cancelled_order_no_payment.sql (event_order_seats, admin_bank_transfer_order)
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
  seats: { remaining: number | null; tierRemaining: number | null; quantity: number; oversold: boolean; started: boolean } | null;
  coupon: { code: string | null; status: LateCouponStatus } | null;
  invoiceCorrected: boolean;
}
interface SessionAvailability { id: string; starts_at: string; current_tier: { price: number } | null }
interface OrderSeats { quantity: number; session_remaining: number | null; tier_remaining: number | null; oversold: boolean }
const seatsLeft = (n: number | null) => n === null ? null : Math.max(0, n);

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
    const at = now.toISOString();
    const [{ data }, { data: facts, error }] = await Promise.all([
      db.rpc('event_availability', { p_product_id: tx.product_id, p_at: at }),
      db.rpc('event_order_seats', { p_transaction_id: id, p_at: at }),
    ]);
    if (error || !facts) return null;
    const session = (data as SessionAvailability[] | null)?.find(s => s.id === main.session_id);
    const f = facts as unknown as OrderSeats;
    unitPriceToday = session?.current_tier ? Number(session.current_tier.price) : null;
    seats = { remaining: seatsLeft(f.session_remaining), tierRemaining: seatsLeft(f.tier_remaining), quantity: f.quantity,
      oversold: f.oversold === true, started: !session || Date.parse(session.starts_at) <= now.getTime() };
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
