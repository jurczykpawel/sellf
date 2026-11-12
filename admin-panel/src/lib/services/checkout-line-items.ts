/**
 * Shared, pure builder for per-line checkout specs (main product + each order bump).
 *
 * Both the embedded and the Elements checkout charge the same total; this builder
 * lets the Elements flow emit one Stripe line item per product (instead of a single
 * combined line) so per-line tax can be captured — WITHOUT changing the amount
 * charged.
 *
 * The sum of `unitAmountMinor` across specs equals `totalMinor`: the post-coupon
 * pricing basis before exclusive VAT. `computeLinePayableMinor` adds local VAT
 * to net lines. Both checkout flows share this allocation.
 */

import { fromMinorUnits, toMinorUnits } from '@/lib/currency/minor-units';
import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';
import type { CouponPricingInput } from '@/lib/pricing/coupon-allocation';

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
  quantity: number;
  /** List total for the whole line, before coupon, in minor units. */
  listAmountMinor: number;
  vatExempt: boolean;
  isBump: boolean;
  name: string;
  description: string | null;
  currency: string;
  /** Post-coupon amount for this line, in MINOR units (cents/grosze; whole units for zero-decimal currencies such as JPY). */
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
  quantity?: number;
  bumps: Array<{ product: CheckoutLineProduct; price: number }>;
  coupon: CouponPricingInput | null;
  taxMode: 'local' | 'stripe_tax';
}

/**
 * PURE: what the buyer pays for one line, in MINOR units. A net line (taxBehavior
 * 'exclusive' with a local TaxRate) gets its VAT added on top, rounded per line like
 * Stripe does; gross lines, lines without a local rate and Stripe Tax lines (rate
 * unknown here, Stripe computes it) are charged exactly `unitAmountMinor`.
 * The checkout page's payable total (`calculatePricing`) sums this over the lines built by
 * `buildCheckoutLineSpecs`, the same builder the server uses for Stripe line items, so the
 * per-line rate, gross/net and exemption rules cannot drift from the charge.
 */
export function computeLinePayableMinor(spec: Pick<CheckoutLineSpec, 'unitAmountMinor' | 'vatRate' | 'priceIncludesVat'>): number {
  return spec.vatRate && !spec.priceIncludesVat
    ? spec.unitAmountMinor + Math.round((spec.unitAmountMinor * spec.vatRate) / 100)
    : spec.unitAmountMinor;
}

export interface BuildLineSpecsResult {
  specs: CheckoutLineSpec[];
  /** True when a coupon covers the full price (pre-minimum-floor) — caller must reject/handle. */
  isFree: boolean;
  /** Sum of post-coupon line amounts after the minimum floor, before exclusive VAT. */
  totalMinor: number;
  /** The total was raised to the Stripe minimum charge (discount capped). */
  minimumApplied: boolean;
}

/**
 * PURE: one spec per line, main first then bumps in order (matching the order the
 * RPC writes payment_line_items rows). Coupon discount is allocated per line via the
 * shared `allocateCouponDiscount` primitive.
 */
export function buildCheckoutLineSpecs(params: BuildLineSpecsParams): BuildLineSpecsResult {
  const { main, mainPrice, bumps, coupon, taxMode, quantity = 1 } = params;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Invalid order quantity');
  const mainListMinor = toMinorUnits(mainPrice, main.currency) * quantity;

  const allocation = allocateCouponDiscount({
    currency: main.currency,
    items: [
      { kind: 'base', id: main.id, quantity, price: fromMinorUnits(mainListMinor, main.currency) },
      ...bumps.map((b) => ({ kind: 'bump' as const, id: b.product.id, price: b.price })),
    ],
    baseProductId: main.id,
    coupon,
    applyMinimumFloor: true,
  });

  const isLocal = taxMode === 'local';

  const toSpec = (
    product: CheckoutLineProduct,
    isBump: boolean,
    finalPrice: number,
    listAmountMinor: number,
    lineQuantity: number,
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
      quantity: lineQuantity,
      listAmountMinor,
      vatExempt: exempt,
      isBump,
      name: product.name,
      description: product.description ?? null,
      currency: product.currency.toLowerCase(),
      unitAmountMinor: toMinorUnits(finalPrice, product.currency),
      vatRate,
      priceIncludesVat,
      taxBehavior,
    };
  };

  const specs: CheckoutLineSpec[] = [toSpec(main, false, allocation.items[0].finalPrice, mainListMinor, quantity)];
  bumps.forEach((b, i) => {
    specs.push(toSpec(b.product, true, allocation.items[i + 1].finalPrice, toMinorUnits(b.price, b.product.currency), 1));
  });
  const totalMinor = specs.reduce((sum, s) => sum + s.unitAmountMinor, 0);
  return { specs, isFree: allocation.isFree, totalMinor, minimumApplied: allocation.minimumApplied };
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
  if (specs.some(spec => !Number.isInteger(spec.quantity) || spec.quantity < 1 || spec.quantity > 100
    || (spec.isBump && spec.quantity !== 1))) {
    throw new Error('Invalid Stripe line quantity');
  }
  const lineItems: Record<string, unknown>[] = [];
  for (const spec of specs) {
    const taxRates = spec.vatRate
      ? [await opts.resolveTaxRate({ percentage: spec.vatRate, inclusive: spec.priceIncludesVat })]
      : undefined;
    lineItems.push({
      price_data: {
        currency: spec.currency,
        product_data: {
          name: spec.quantity > 1 ? `${spec.name} × ${spec.quantity}` : spec.name,
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

/** Saved line prices are in major units; list and discounted totals remain separate.
 * @see supabase/migrations/20261110235903_release_2026_11_0_orders_events.sql
 */
export function buildOrderSnapshotLines(
  specs: CheckoutLineSpec[],
  options: { orderBumpIds: Record<string, string>; accessOverrides: Record<string, number | null> },
): OrderSnapshotLine[] {
  if (specs.some(spec => spec.currency.toUpperCase() !== specs[0].currency.toUpperCase())) throw new Error('Mixed order currencies');
  return specs.map(spec => ({
    product_id: spec.productId,
    item_type: spec.isBump ? 'order_bump' : 'main_product',
    quantity: spec.quantity,
    unit_price: fromMinorUnits(spec.listAmountMinor / spec.quantity, spec.currency),
    total_price: fromMinorUnits(spec.listAmountMinor, spec.currency),
    discounted_total: fromMinorUnits(spec.unitAmountMinor, spec.currency),
    currency: spec.currency.toUpperCase(),
    product_name: spec.name,
    order_bump_id: spec.isBump ? options.orderBumpIds[spec.productId] ?? null : null,
    access_duration_override: spec.isBump ? options.accessOverrides[spec.productId] ?? null : null,
    vat_rate: spec.vatRate,
    tax_behavior: spec.taxBehavior,
    vat_exempt: spec.vatExempt,
  }));
}

export interface OrderSnapshotLine {
  session_id?: string | null;
  tier_id?: string | null;
  session_label?: string | null;
  session_starts_at?: string | null;
  product_id: string;
  item_type: 'main_product' | 'order_bump';
  quantity: number;
  unit_price: number;
  total_price: number;
  discounted_total: number;
  currency: string;
  product_name: string;
  order_bump_id: string | null;
  access_duration_override: number | null;
  vat_rate: number | null;
  tax_behavior: 'inclusive' | 'exclusive' | null;
  vat_exempt: boolean;
}
