/**
 * VAT/tax snapshot extraction — single source of truth for reading Stripe's
 * computed tax and normalizing it into a Stripe-shape-free snapshot that the rest
 * of Sellf (DB persistence, webhook payload, orders API) consumes.
 *
 * Numbers always come from Stripe (never re-computed): per-line `amount_subtotal`
 * (net) / `amount_tax`, and the full `taxes[]` breakdown. A single derived
 * `vatRate` is set ONLY when a line has exactly one tax component; for 0 or many
 * components it is null and the truth lives in `breakdown` (Stripe Tax can split a
 * line across up to 10 jurisdictions). All amounts are MINOR units (cents/grosze).
 *
 * @see docs/superpowers/specs/2026-06-22-vat-tax-snapshot-design.md
 * @see docs/superpowers/specs/2026-06-22-vat-tax-snapshot-stripe-extraction-research.md
 */

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

/** One Stripe tax component on a line (one jurisdiction/rate). Amounts MINOR units. */
export interface TaxComponent {
  amount: number;
  taxableAmount: number;
  rate: number | null;
  effectiveRate: number | null;
  inclusive: boolean;
  taxType: string | null;
  jurisdiction: string | null;
  country: string | null;
  state: string | null;
  taxabilityReason: string | null;
}

/** Per-line tax snapshot. Amounts MINOR units. */
export interface LineTaxSnapshot {
  productId: string | null;
  isBump: boolean;
  netAmount: number | null;
  taxAmount: number | null;
  grossAmount: number | null;
  /** Single-component effectiveRate; null for 0 or >1 components. */
  vatRate: number | null;
  taxBehavior: 'inclusive' | 'exclusive' | null;
  taxabilityReason: string | null;
  breakdown: TaxComponent[];
}

export type TaxSnapshotStatus = 'none' | 'captured' | 'partial' | 'unavailable';

/** Order-level tax snapshot. Amounts MINOR units. */
export interface OrderTaxSnapshot {
  netTotal: number | null;
  taxTotal: number | null;
  currency: string;
  status: TaxSnapshotStatus;
  lines: LineTaxSnapshot[];
}

function productMetadata(line: Stripe.LineItem): Record<string, string> {
  const product = line.price?.product;
  if (product && typeof product === 'object' && 'metadata' in product && product.metadata) {
    return product.metadata as Record<string, string>;
  }
  return {};
}

function mapComponents(line: Stripe.LineItem): TaxComponent[] {
  const taxes = line.taxes ?? [];
  return taxes.map((t) => {
    const rate = t.rate;
    return {
      amount: t.amount ?? 0,
      taxableAmount: t.taxable_amount ?? 0,
      rate: rate?.percentage ?? null,
      effectiveRate: rate?.effective_percentage ?? rate?.percentage ?? null,
      inclusive: rate?.inclusive ?? false,
      taxType: rate?.tax_type ?? null,
      jurisdiction: rate?.jurisdiction ?? null,
      country: rate?.country ?? null,
      state: rate?.state ?? null,
      taxabilityReason: t.taxability_reason ?? null,
    };
  });
}

function mapLine(line: Stripe.LineItem): LineTaxSnapshot {
  const meta = productMetadata(line);
  const breakdown = mapComponents(line);
  // Single rate is "safe" iff exactly one component (never sum percentages).
  const vatRate = breakdown.length === 1 ? breakdown[0].effectiveRate : null;
  const taxBehavior: LineTaxSnapshot['taxBehavior'] =
    breakdown.length === 0 ? null : breakdown[0].inclusive ? 'inclusive' : 'exclusive';
  return {
    productId: meta.product_id ?? null,
    isBump: meta.is_bump === 'true',
    netAmount: line.amount_subtotal ?? null,
    taxAmount: line.amount_tax ?? null,
    grossAmount: line.amount_total ?? null,
    vatRate,
    taxBehavior,
    taxabilityReason: breakdown[0]?.taxabilityReason ?? null,
    breakdown,
  };
}

/**
 * PURE: normalize already-fetched Stripe Checkout line items + session totals into
 * an OrderTaxSnapshot. `partial` is never produced here — it is decided later by the
 * line→row matcher in persistTaxSnapshot (this layer has no DB rows to match).
 */
export function buildTaxSnapshotFromCheckoutLines(
  lines: Stripe.LineItem[],
  totals: { amountSubtotal: number | null; amountTax: number | null; currency: string },
): OrderTaxSnapshot {
  const snapshotLines = lines.map(mapLine);

  let status: TaxSnapshotStatus;
  if (totals.amountTax === null || totals.amountTax === undefined) {
    status = 'unavailable';
  } else if (totals.amountTax === 0 && snapshotLines.every((l) => l.breakdown.length === 0)) {
    status = 'none';
  } else {
    status = 'captured';
  }

  return {
    netTotal: totals.amountSubtotal ?? null,
    taxTotal: totals.amountTax ?? null,
    currency: totals.currency,
    status,
    lines: snapshotLines,
  };
}

/**
 * ASYNC: fetch a Checkout Session's line items (with tax + product metadata) and
 * session-level totals, then normalize. Used by the capture handlers.
 * Driven off listLineItems (paginated) so it survives >10 line orders.
 */
export async function captureCheckoutSessionTax(
  stripe: Stripe,
  sessionId: string,
): Promise<OrderTaxSnapshot> {
  const [lineItems, session] = await Promise.all([
    stripe.checkout.sessions.listLineItems(sessionId, {
      expand: ['data.taxes', 'data.price.product'],
      limit: 100,
    }),
    stripe.checkout.sessions.retrieve(sessionId, { expand: ['total_details.breakdown'] }),
  ]);

  return buildTaxSnapshotFromCheckoutLines(lineItems.data, {
    amountSubtotal: session.amount_subtotal,
    amountTax: session.total_details?.amount_tax ?? null,
    currency: session.currency ?? 'usd',
  });
}

/**
 * Phase 2 seam: subscription invoices carry tax differently (invoice.lines.data[].
 * tax_amounts[] with tax_rate ids). Not wired in Phase 1.
 */
export function buildTaxSnapshotFromInvoice(_invoice: Stripe.Invoice): OrderTaxSnapshot {
  throw new Error('buildTaxSnapshotFromInvoice: subscriptions are Phase 2');
}

/** A payment_line_items row, subset needed to match a snapshot line to it. */
export interface LineRow {
  id: string;
  product_id: string | null;
  item_type: 'main_product' | 'order_bump';
}

export interface SnapshotPair {
  row: LineRow;
  line: LineTaxSnapshot;
}

/**
 * PURE: match snapshot lines (from Stripe) to the payment_line_items rows the RPC
 * already wrote. Strategy: by product_id when every line carries it (handles bumps
 * + reordering); else positional only when counts match exactly; else cannot match
 * safely. `complete: false` means the caller MUST NOT write per-line values — only
 * order-level totals + status 'partial' (never fabricate a per-line tax number).
 */
export function matchSnapshotLinesToRows(
  lines: LineTaxSnapshot[],
  rows: LineRow[],
): { pairs: SnapshotPair[]; complete: boolean } {
  // Strategy 1: product_id (strongest — survives bumps + reordering).
  if (lines.length > 0 && lines.every((l) => l.productId)) {
    const pairs: SnapshotPair[] = [];
    const remaining = [...lines];
    for (const row of rows) {
      const idx = remaining.findIndex((l) => l.productId === row.product_id);
      if (idx >= 0) pairs.push({ row, line: remaining.splice(idx, 1)[0] });
    }
    const complete = pairs.length === rows.length && remaining.length === 0;
    return { pairs, complete };
  }
  // Strategy 2: positional, only when counts match exactly.
  if (rows.length > 0 && rows.length === lines.length) {
    return { pairs: rows.map((row, i) => ({ row, line: lines[i] })), complete: true };
  }
  // Strategy 3: cannot match safely.
  return { pairs: [], complete: false };
}

/**
 * Persist a captured snapshot: UPDATE the payment_line_items rows (only when the
 * match is complete — never write partial/guessed per-line numbers) and the
 * payment_transactions totals + status. Per-line `vat_exempt` is the product's
 * vat_exempt snapshot at purchase (label authority in local tax mode).
 */
export async function persistTaxSnapshot(
  supabase: SupabaseClient<Database>,
  transactionId: string,
  snapshot: OrderTaxSnapshot,
): Promise<{ matched: number; status: TaxSnapshotStatus }> {
  const { data: rows } = await supabase
    .from('payment_line_items')
    .select('id, product_id, item_type')
    .eq('transaction_id', transactionId);

  const { pairs, complete } = matchSnapshotLinesToRows(snapshot.lines, (rows ?? []) as LineRow[]);

  let matched = 0;
  if (complete) {
    const productIds = [
      ...new Set(pairs.map((p) => p.row.product_id).filter((id): id is string => !!id)),
    ];
    const exemptById = new Map<string, boolean>();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, vat_exempt')
        .in('id', productIds);
      for (const p of products ?? []) exemptById.set(p.id, p.vat_exempt ?? false);
    }
    for (const { row, line } of pairs) {
      await supabase
        .from('payment_line_items')
        .update({
          tax_breakdown: line.breakdown as unknown as Json,
          tax_amount: line.taxAmount,
          net_amount: line.netAmount,
          vat_rate: line.vatRate,
          tax_behavior: line.taxBehavior,
          vat_exempt: row.product_id ? exemptById.get(row.product_id) ?? false : false,
          taxability_reason: line.taxabilityReason,
        })
        .eq('id', row.id);
      matched += 1;
    }
  }

  const status: TaxSnapshotStatus =
    snapshot.status === 'unavailable' ? 'unavailable' : !complete ? 'partial' : snapshot.status;

  await supabase
    .from('payment_transactions')
    .update({ net_total: snapshot.netTotal, tax_total: snapshot.taxTotal, tax_snapshot_status: status })
    .eq('id', transactionId);

  return { matched, status };
}
