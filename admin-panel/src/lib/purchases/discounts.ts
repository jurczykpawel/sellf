import { fromMinorUnits, toMinorUnits } from '@/lib/currency/minor-units';

export type PurchaseDiscountKind = 'percentage' | 'fixed';

export interface ParsedPurchaseDiscount {
  kind: PurchaseDiscountKind;
  value: number;
  currencyCode?: string | null;
}

export interface PurchaseDiscountSummary {
  subtotal: number;
  discountAmount: number;
  totalPaid: number;
  couponDiscount: ParsedPurchaseDiscount | null;
}

const PERCENTAGE_DISCOUNT_PATTERN = /^([0-9]+(?:\.[0-9]+)?)%$/;
const FIXED_DISCOUNT_PATTERN = /^([0-9]+(?:\.[0-9]+)?)([A-Z]{3})$/;

function roundToCurrencyPrecision(amount: number, currency: string): number {
  return fromMinorUnits(toMinorUnits(amount, currency), currency);
}

export function parseCouponDiscount(rawDiscount: string | null | undefined): ParsedPurchaseDiscount | null {
  if (!rawDiscount) return null;

  const normalized = rawDiscount.trim().toUpperCase();
  if (!normalized) return null;

  const percentageMatch = normalized.match(PERCENTAGE_DISCOUNT_PATTERN);
  if (percentageMatch) {
    return {
      kind: 'percentage',
      value: Number(percentageMatch[1]),
      currencyCode: null,
    };
  }

  const fixedMatch = normalized.match(FIXED_DISCOUNT_PATTERN);
  if (fixedMatch) {
    return {
      kind: 'fixed',
      value: Number(fixedMatch[1]),
      currencyCode: fixedMatch[2],
    };
  }

  return null;
}

export function buildPurchaseDiscountSummary(params: {
  subtotal: number;
  totalPaid: number;
  currency: string;
  couponDiscount?: string | null;
}): PurchaseDiscountSummary | null {
  const subtotal = Number.isFinite(params.subtotal) ? roundToCurrencyPrecision(params.subtotal, params.currency) : 0;
  const totalPaid = Number.isFinite(params.totalPaid) ? roundToCurrencyPrecision(params.totalPaid, params.currency) : 0;
  const discountAmount = roundToCurrencyPrecision(subtotal - totalPaid, params.currency);

  if (discountAmount <= 0) return null;

  return {
    subtotal,
    totalPaid,
    discountAmount,
    couponDiscount: parseCouponDiscount(params.couponDiscount),
  };
}
