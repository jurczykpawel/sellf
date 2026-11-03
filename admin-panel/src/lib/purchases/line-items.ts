/** Purchase display values use saved prices and tax snapshots. @see lib/orders/local-tax.ts */
import { fromMinorUnits, toMinorUnits } from '@/lib/currency/minor-units';

export type PurchaseLineItemType = 'main_product' | 'order_bump' | string;

export interface PurchaseLineItemProduct {
  name?: string | null;
  slug?: string | null;
  icon?: string | null;
  is_refundable?: boolean | null;
  refund_period_days?: number | null;
  checkout_profile?: unknown;
}

export interface PurchaseLineItem {
  id: string;
  transaction_id: string;
  product_id: string;
  item_type: PurchaseLineItemType;
  product_name: string | null;
  quantity: number;
  total_price: number;
  discounted_total?: number | null;
  net_amount?: number | null;
  tax_amount?: number | null;
  tax_behavior?: string | null;
  vat_rate?: number | null;
  vat_exempt?: boolean | null;
  currency: string;
  product?: PurchaseLineItemProduct | null;
}

export type LineItemRefundState = 'refundable' | 'not_refundable' | 'period_expired' | 'refunded';

export interface NormalizedPurchaseLineItem extends PurchaseLineItem {
  displayName: string;
  refundState: LineItemRefundState;
  grossTotal: number;
  grossSubtotal: number;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function getLineItemRefundState(
  item: Pick<PurchaseLineItem, 'product'>,
  purchaseDate: string,
  transactionStatus: string
): LineItemRefundState {
  if (transactionStatus === 'refunded') return 'refunded';
  if (item.product?.is_refundable !== true) return 'not_refundable';

  const refundPeriodDays = item.product.refund_period_days;
  if (typeof refundPeriodDays === 'number') {
    const purchasedAt = new Date(purchaseDate).getTime();
    if (!Number.isNaN(purchasedAt)) {
      const deadline = purchasedAt + refundPeriodDays * 24 * 60 * 60 * 1000;
      if (Date.now() > deadline) return 'period_expired';
    }
  }

  return 'refundable';
}

export function normalizePurchaseLineItems(
  items: PurchaseLineItem[],
  purchaseDate: string,
  transactionStatus: string
): NormalizedPurchaseLineItem[] {
  return [...items]
    .sort((a, b) => {
      if (a.item_type === b.item_type) return a.product_name?.localeCompare(b.product_name || '') || 0;
      if (a.item_type === 'main_product') return -1;
      if (b.item_type === 'main_product') return 1;
      return 0;
    })
    .map(item => {
      const net = toNumber(item.net_amount);
      const tax = toNumber(item.tax_amount);
      const taxRate = item.vat_rate != null ? toNumber(item.vat_rate) / 100 : net > 0 ? tax / net : 0;
      const rate = item.tax_behavior === 'exclusive' && !item.vat_exempt ? taxRate : 0;
      return {
        ...item,
        total_price: toNumber(item.total_price),
        quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
        displayName: item.product_name || item.product?.name || 'Product',
        refundState: getLineItemRefundState(item, purchaseDate, transactionStatus),
        grossTotal: item.net_amount != null && item.tax_amount != null
          ? fromMinorUnits(net + tax, item.currency) : toNumber(item.discounted_total ?? item.total_price),
        grossSubtotal: fromMinorUnits(toMinorUnits(toNumber(item.total_price) * (1 + rate), item.currency), item.currency),
      };
    });
}

export function hasMixedRefundPolicies(items: NormalizedPurchaseLineItem[]): boolean {
  return new Set(items.map(item => JSON.stringify([
    item.product?.is_refundable === true,
    item.product?.is_refundable === true ? item.product.refund_period_days ?? null : null,
  ]))).size > 1;
}

export function requiresManualRefundReview(items: NormalizedPurchaseLineItem[]): boolean {
  return hasMixedRefundPolicies(items);
}
