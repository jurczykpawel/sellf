/**
 * Parses the optional partial-refund amount typed in the admin refund dialog.
 * Empty input = refund everything that is still refundable.
 * @see src/components/admin/PaymentTransactionsTable.tsx
 * @see src/lib/actions/payment.ts (server re-validates against the remaining amount)
 */
import { currencyExponent, toMinorUnits } from '@/lib/currency/minor-units';

export type RefundAmountResult =
  | { ok: true; amountMinor: number; partial: boolean }
  | { ok: false; error: 'invalid' | 'exceedsRemaining' };

export function parseRefundAmountInput(input: string, remainingMinor: number, currency: string): RefundAmountResult {
  const trimmed = input.trim().replace(',', '.');
  if (!trimmed) return { ok: true, amountMinor: remainingMinor, partial: false };
  const decimals = currencyExponent(currency);
  const pattern = decimals === 0 ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(trimmed)) return { ok: false, error: 'invalid' };
  const amountMinor = toMinorUnits(Number(trimmed), currency);
  if (amountMinor <= 0) return { ok: false, error: 'invalid' };
  if (amountMinor > remainingMinor) return { ok: false, error: 'exceedsRemaining' };
  return { ok: true, amountMinor, partial: amountMinor < remainingMinor };
}
