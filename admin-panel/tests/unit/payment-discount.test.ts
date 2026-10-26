import { expect, it } from 'vitest';
import { getPaymentDiscount } from '@/lib/payments/discount';
import type { PaymentTransaction } from '@/types/payment';
const transaction = (patch = {}) => ({ currency: 'PLN', amount: 4410, metadata: {}, coupon_code: 'SAVE10',
  line_items: [{ total_price: 49, discounted_total: 44.1 }], ...patch }) as unknown as PaymentTransaction;
it('uses saved line discounts in major units', () => expect(getPaymentDiscount(transaction())).toEqual({ code: 'SAVE10', amount: 4.9 }));
it('does not treat extra tax as a discount', () => expect(getPaymentDiscount(transaction({ amount: 5424 }))).toEqual({ code: 'SAVE10', amount: 4.9 }));
it('handles zero-decimal snapshots', () => expect(getPaymentDiscount(transaction({ currency: 'JPY', line_items: [{ total_price: 1000, discounted_total: 900 }] }))).toEqual({ code: 'SAVE10', amount: 100 }));
it('does not invent a discount when snapshots are absent', () => expect(getPaymentDiscount(transaction({ coupon_code: null, line_items: [] }))).toEqual({ code: null, amount: 0 }));

it('explains a legacy coupon purchase without discounted line snapshots', () => expect(getPaymentDiscount(transaction({ line_items: [{ total_price: 49, discounted_total: null }] }))).toEqual({ code: 'SAVE10', amount: 4.9 }));
it('uses captured exclusive tax to explain a legacy net-price coupon', () => expect(getPaymentDiscount(transaction({ amount: 5424, line_items: [{ total_price: 49, discounted_total: null, net_amount: 4410, tax_amount: 1014, tax_behavior: 'exclusive' }] }))).toEqual({ code: 'SAVE10', amount: 4.9 }));
it('does not label a legacy price difference as a discount without a coupon', () => expect(getPaymentDiscount(transaction({ coupon_code: null, line_items: [{ total_price: 49 }] }))).toEqual({ code: null, amount: 0 }));
