import { describe, expect, it, vi } from 'vitest';
import {
  getLineItemRefundState,
  hasMixedRefundPolicies,
  normalizePurchaseLineItems,
  requiresManualRefundReview,
  type PurchaseLineItem,
} from '@/lib/purchases/line-items';

const baseItem = {
  id: 'line-1',
  transaction_id: 'tx-1',
  product_id: 'product-1',
  item_type: 'main_product',
  product_name: 'Main Product',
  quantity: 1,
  total_price: 100,
  currency: 'USD',
} satisfies PurchaseLineItem;

describe('purchase line items', () => {
  it('sorts main product before order bumps and normalizes numeric prices', () => {
    const items = normalizePurchaseLineItems([
      {
        ...baseItem,
        id: 'line-2',
        product_id: 'bump-1',
        item_type: 'order_bump',
        product_name: 'Order Bump',
        total_price: '49.99' as unknown as number,
      },
      baseItem,
    ], '2026-05-08T10:00:00.000Z', 'completed');

    expect(items.map(item => item.item_type)).toEqual(['main_product', 'order_bump']);
    expect(items[1].total_price).toBe(49.99);
  });

  it('marks line item refund eligibility from each product policy', () => {
    vi.setSystemTime(new Date('2026-05-10T10:00:00.000Z'));

    expect(getLineItemRefundState({
      product: { is_refundable: true, refund_period_days: 14 },
    }, '2026-05-08T10:00:00.000Z', 'completed')).toBe('refundable');

    expect(getLineItemRefundState({
      product: { is_refundable: false, refund_period_days: null },
    }, '2026-05-08T10:00:00.000Z', 'completed')).toBe('not_refundable');

    vi.useRealTimers();
  });

  it('detects mixed refund policies inside one transaction', () => {
    const normalized = normalizePurchaseLineItems([
      { ...baseItem, product: { is_refundable: true, refund_period_days: null } },
      {
        ...baseItem,
        id: 'line-2',
        product_id: 'bump-1',
        item_type: 'order_bump',
        product_name: 'Non-refundable bump',
        product: { is_refundable: false, refund_period_days: null },
      },
    ], '2026-05-08T10:00:00.000Z', 'completed');

    expect(hasMixedRefundPolicies(normalized)).toBe(true);
    expect(requiresManualRefundReview(normalized)).toBe(true);
  });
});
