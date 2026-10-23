/** Coupon amounts in major units. @see pricing/coupon-allocation.ts */
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { moneyAmountError } from '@/lib/currency/parse-money-input';

export function couponValueError(type: string, value: number, currency?: string | null): string | null {
  if (!['percentage', 'fixed', 'set_price'].includes(type)) return 'Invalid discount type';
  if (!Number.isFinite(value) || value < 0 || (value === 0 && type !== 'set_price')) return 'Invalid discount value';
  if (type === 'percentage') return value <= 100 ? null : 'Percentage discount cannot exceed 100%';
  if (typeof currency !== 'string' || !currency || !(SUPPORTED_CURRENCY_CODES as readonly string[]).includes(currency.toUpperCase())) return 'Currency is required and must be supported';
  if (value > 99999999 || moneyAmountError(value, currency)) return 'Invalid amount for coupon currency';
  return null;
}
