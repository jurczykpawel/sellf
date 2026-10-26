/** Saved payment discounts, in the transaction currency. @see types/payment.ts */
import { fromMinorUnits, toMinorUnits } from '@/lib/currency/minor-units';
import type { PaymentTransaction } from '@/types/payment';

interface PaymentDiscountInfo { code: string | null; amount: number }

export function getPaymentDiscount(transaction: PaymentTransaction): PaymentDiscountInfo {
  const code = transaction.coupon_code ?? (typeof transaction.metadata.coupon_code === 'string' ? transaction.metadata.coupon_code : null);
  const lines = transaction.line_items ?? [];
  const totals = lines.map(line => line.discounted_total != null ? toMinorUnits(line.discounted_total, transaction.currency)
    : line.net_amount != null && line.tax_amount != null && line.tax_behavior ? line.net_amount + (line.tax_behavior === 'inclusive' ? line.tax_amount : 0) : null);
  const listTotal = lines.reduce((sum, line) => sum + toMinorUnits(line.total_price, transaction.currency), 0);
  const hasCoupon = !!(code || transaction.metadata.has_coupon === true || transaction.metadata.has_coupon === 'true' || transaction.metadata.coupon_id);
  const exclusiveTax = lines.reduce((sum, line) => sum + (line.tax_behavior === 'exclusive' ? line.tax_amount ?? 0 : 0), 0);
  const paidBasis = totals.every(value => value !== null) ? totals.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : hasCoupon ? transaction.amount - exclusiveTax : listTotal;
  return { code, amount: fromMinorUnits(Math.max(0, listTotal - paidBasis), transaction.currency) };
}
