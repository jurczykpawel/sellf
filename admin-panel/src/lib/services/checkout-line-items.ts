/**
 * Shared, pure builder for per-line checkout specs (main product + each order bump).
 *
 * Both the embedded and the Elements checkout charge the same total; this builder
 * lets the Elements flow emit one Stripe line item per product (instead of a single
 * combined line) so per-line tax can be captured — WITHOUT changing the amount
 * charged.
 *
 * SAFETY INVARIANT (covered by tests): the sum of `unitAmountMinor` across the specs
 * equals `Math.round(calculatePricing(...).totalGross * 100)` for the same inputs,
 * because both derive the per-line amounts from the SAME `allocateCouponDiscount`
 * call. Splitting the charge into per-line items therefore never changes the total.
 */

import { STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';
import {
  allocateCouponDiscount,
  toMinorUnits,
  type CouponPricingInput,
} from '@/lib/pricing/coupon-allocation';

export interface CheckoutLineProduct {
  id: string;
  name: string;
  description?: string | null;
  currency: string;
  vatRate?: number | null;
  priceIncludesVat?: boolean;
  vatExempt?: boolean;
}

export interface CheckoutLineSpec {
  productId: string;
  isBump: boolean;
  name: string;
  description: string | null;
  currency: string;
  /** Post-coupon amount for this line, in MINOR units (cents/grosze). */
  unitAmountMinor: number;
  /** Rate to attach as a Stripe TaxRate in local mode; null when exempt / 0 / stripe_tax. */
  vatRate: number | null;
  priceIncludesVat: boolean;
  /** Stripe tax_behavior; null when no tax line should be declared. */
  taxBehavior: 'inclusive' | 'exclusive' | null;
}

export interface BuildLineSpecsParams {
  main: CheckoutLineProduct;
  /** Base price already resolved by the caller (PWYW customAmount or effective unit price). */
  mainPrice: number;
  bumps: Array<{ product: CheckoutLineProduct; price: number }>;
  coupon: CouponPricingInput | null;
  taxMode: 'local' | 'stripe_tax';
}

export interface BuildLineSpecsResult {
  specs: CheckoutLineSpec[];
  /** True when a coupon covers the full price (pre-minimum-floor) — caller must reject/handle. */
  isFree: boolean;
  /** Sum of line unitAmountMinor (post-floor) — the exact total that will be charged. */
  totalMinor: number;
}

/**
 * PURE: one spec per line, main first then bumps in order (matching the order the
 * RPC writes payment_line_items rows). Coupon discount is allocated per line via the
 * shared `allocateCouponDiscount` primitive.
 */
export function buildCheckoutLineSpecs(params: BuildLineSpecsParams): BuildLineSpecsResult {
  const { main, mainPrice, bumps, coupon, taxMode } = params;

  const allocation = allocateCouponDiscount({
    items: [
      { kind: 'base', id: main.id, price: mainPrice },
      ...bumps.map((b) => ({ kind: 'bump' as const, id: b.product.id, price: b.price })),
    ],
    baseProductId: main.id,
    coupon,
    applyMinimumFloor: true,
    minimumAmount: STRIPE_MINIMUM_AMOUNT,
  });

  const isLocal = taxMode === 'local';

  const toSpec = (
    product: CheckoutLineProduct,
    isBump: boolean,
    finalPrice: number,
  ): CheckoutLineSpec => {
    const priceIncludesVat = product.priceIncludesVat ?? false;
    const exempt = product.vatExempt ?? false;
    // Local mode attaches a TaxRate only for a real (>0) rate on a non-exempt product —
    // mirrors checkout.ts. A 0%/exempt line declares no tax rate (Stripe reports 0 tax).
    const hasLocalRate = isLocal && !exempt && !!product.vatRate && product.vatRate > 0;
    const vatRate = hasLocalRate ? (product.vatRate as number) : null;
    // tax_behavior: local+rate → inclusive/exclusive; stripe_tax → always set; else none.
    const taxBehavior: CheckoutLineSpec['taxBehavior'] =
      (isLocal && hasLocalRate) || !isLocal ? (priceIncludesVat ? 'inclusive' : 'exclusive') : null;
    return {
      productId: product.id,
      isBump,
      name: product.name,
      description: product.description ?? null,
      currency: product.currency.toLowerCase(),
      unitAmountMinor: toMinorUnits(finalPrice),
      vatRate,
      priceIncludesVat,
      taxBehavior,
    };
  };

  const specs: CheckoutLineSpec[] = [toSpec(main, false, allocation.items[0].finalPrice)];
  bumps.forEach((b, i) => {
    specs.push(toSpec(b.product, true, allocation.items[i + 1].finalPrice));
  });
  const totalMinor = specs.reduce((sum, s) => sum + s.unitAmountMinor, 0);
  return { specs, isFree: allocation.isFree, totalMinor };
}

/** Resolves a (percentage, inclusive) pair to a Stripe TaxRate id. Injected for testability. */
export type StripeTaxRateResolver = (params: {
  percentage: number;
  inclusive: boolean;
}) => Promise<string>;

/**
 * Map line specs to Stripe `line_items` (price_data + tax_behavior + tax_rates +
 * product metadata). Shared by the embedded and Elements checkout flows so both
 * build identical lines. The tax-rate resolver is injected (DI) for testability.
 * Every line carries `metadata.product_id` (and `is_bump` on bumps) so the tax
 * snapshot can match Stripe lines back to payment_line_items rows.
 */
export async function buildStripeLineItems(
  specs: CheckoutLineSpec[],
  opts: { resolveTaxRate: StripeTaxRateResolver },
): Promise<Record<string, unknown>[]> {
  const lineItems: Record<string, unknown>[] = [];
  for (const spec of specs) {
    const taxRates = spec.vatRate
      ? [await opts.resolveTaxRate({ percentage: spec.vatRate, inclusive: spec.priceIncludesVat })]
      : undefined;
    lineItems.push({
      price_data: {
        currency: spec.currency,
        product_data: {
          name: spec.name,
          ...(spec.description ? { description: spec.description } : {}),
          metadata: { product_id: spec.productId, ...(spec.isBump ? { is_bump: 'true' } : {}) },
        },
        unit_amount: spec.unitAmountMinor,
        ...(spec.taxBehavior ? { tax_behavior: spec.taxBehavior } : {}),
      },
      ...(taxRates ? { tax_rates: taxRates } : {}),
      quantity: 1,
    });
  }
  return lineItems;
}
