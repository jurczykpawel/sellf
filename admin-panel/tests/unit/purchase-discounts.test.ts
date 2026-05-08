import { describe, expect, it } from 'vitest';
import {
  buildPurchaseDiscountSummary,
  parseCouponDiscount,
} from '@/lib/purchases/discounts';

describe('purchase discounts', () => {
  it('parses percentage and fixed coupon metadata', () => {
    expect(parseCouponDiscount('20%')).toEqual({
      kind: 'percentage',
      value: 20,
      currencyCode: null,
    });

    expect(parseCouponDiscount('15usd')).toEqual({
      kind: 'fixed',
      value: 15,
      currencyCode: 'USD',
    });
  });

  it('builds a summary from subtotal and paid amount', () => {
    expect(buildPurchaseDiscountSummary({
      subtotal: 99.99,
      totalPaid: 69.99,
      couponDiscount: '30%',
    })).toEqual({
      subtotal: 99.99,
      totalPaid: 69.99,
      discountAmount: 30,
      couponDiscount: {
        kind: 'percentage',
        value: 30,
        currencyCode: null,
      },
    });
  });

  it('returns null when there is no discount to explain', () => {
    expect(buildPurchaseDiscountSummary({
      subtotal: 49.99,
      totalPaid: 49.99,
      couponDiscount: null,
    })).toBeNull();
  });
});
