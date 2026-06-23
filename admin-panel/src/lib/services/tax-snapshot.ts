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
  /**
   * True when Stripe Tax (automatic_tax) computed this order. In that mode Stripe is
   * the SOLE authority on taxability — the seller's local vat_exempt / vat_rate are NOT
   * applied — so consumers MUST NOT label a line exempt from the product flag (a PL "zw."
   * status must not claim exemption where Stripe legitimately charged foreign VAT). The
   * truth lives in taxAmount + taxabilityReason. False = local mode (product flag rules).
   */
  stripeTaxApplied: boolean;
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
  // True net = gross - tax. Stripe's amount_subtotal is GROSS for INCLUSIVE (brutto) lines
  // ("total before EXCLUSIVE taxes are applied"), so it must never be stored as net.
  // amount_total - amount_tax is the true net for both inclusive and exclusive behaviors.
  const taxAmount = line.amount_tax ?? null;
  const grossAmount = line.amount_total ?? null;
  const netAmount =
    grossAmount !== null && taxAmount !== null ? grossAmount - taxAmount : (line.amount_subtotal ?? null);
  return {
    productId: meta.product_id ?? null,
    isBump: meta.is_bump === 'true',
    netAmount,
    taxAmount,
    grossAmount,
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
  totals: {
    /** TRUE net (gross - tax). NOT Stripe's amount_subtotal, which is GROSS for inclusive. */
    netTotal: number | null;
    amountTax: number | null;
    currency: string;
    /** session.automatic_tax.enabled — whether Stripe Tax computed this order. */
    automaticTaxEnabled?: boolean;
  },
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
    netTotal: totals.netTotal ?? null,
    taxTotal: totals.amountTax ?? null,
    currency: totals.currency,
    status,
    stripeTaxApplied: totals.automaticTaxEnabled ?? false,
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

  const amountTax = session.total_details?.amount_tax ?? null;
  const grossTotal = session.amount_total ?? null;
  return buildTaxSnapshotFromCheckoutLines(lineItems.data, {
    // True net = gross - tax. session.amount_subtotal is GROSS for inclusive (brutto) tax,
    // so derive net from amount_total - amount_tax (correct for both behaviors).
    netTotal: grossTotal !== null && amountTax !== null ? grossTotal - amountTax : (session.amount_subtotal ?? null),
    amountTax,
    currency: session.currency ?? 'usd',
    automaticTaxEnabled: session.automatic_tax?.enabled ?? false,
  });
}

/**
 * Capture Stripe's computed tax for a completed order and persist the per-line
 * snapshot. FAIL-SAFE: never throws — a snapshot error must never block access
 * granting or the purchase webhook. On any failure (or a missing session) it marks
 * the transaction `tax_snapshot_status='unavailable'` and returns undefined.
 * Returns the snapshot on success (for the webhook payload). Shared by every capture
 * site (verify-payment session + PI flows, Stripe webhook session + PI handlers).
 */
export async function captureAndPersistOrderTax(params: {
  stripe: Stripe;
  supabase: SupabaseClient<Database>;
  transactionId: string | null | undefined;
  /** Checkout Session id. May be missing — or the PI id — in the PI webhook flow. */
  sessionId: string | null | undefined;
  /**
   * PaymentIntent id. When set and `sessionId` is not a usable Checkout Session id
   * (`cs_…`), the owning session is resolved from the API. This makes tax capture in
   * the `payment_intent.succeeded` webhook independent of which Stripe event (session
   * vs PI) won the race to create the transaction row — a PI flow that stored its own
   * id as session_id still captures the real session's per-line tax.
   */
  paymentIntentId?: string | null;
}): Promise<OrderTaxSnapshot | undefined> {
  const { stripe, supabase, transactionId, paymentIntentId } = params;
  if (!transactionId) return undefined;

  const markUnavailable = async () => {
    try {
      await supabase
        .from('payment_transactions')
        .update({ tax_snapshot_status: 'unavailable' })
        .eq('id', transactionId);
    } catch {
      /* swallow — never throw out of the payment path */
    }
  };

  // Tax lives on the Checkout Session, not the PaymentIntent. The PI handler may have
  // stored the PI id as session_id, so resolve the real cs_ id from the PI when needed.
  let sessionId = params.sessionId ?? null;
  if ((!sessionId || !sessionId.startsWith('cs_')) && paymentIntentId) {
    try {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
      if (sessions.data[0]?.id) sessionId = sessions.data[0].id;
    } catch {
      /* fall through to the cs_ guard below — capture stays fail-safe */
    }
  }

  // No usable session (missing, or a true direct PaymentIntent with no Checkout Session and
  // therefore no per-line tax to read) → record honestly as unavailable, never throw.
  if (!sessionId || !sessionId.startsWith('cs_')) {
    await markUnavailable();
    return undefined;
  }

  try {
    const snapshot = await captureCheckoutSessionTax(stripe, sessionId);
    await persistTaxSnapshot(supabase, transactionId, snapshot);
    return snapshot;
  } catch (e) {
    console.error('[tax-snapshot] capture failed (non-fatal):', e instanceof Error ? e.message : e);
    await markUnavailable();
    return undefined;
  }
}

/**
 * PURE: normalize a paid subscription Invoice into an ORDER-LEVEL OrderTaxSnapshot.
 * Subscriptions have no payment_line_items rows, so this records order totals only
 * (net = total_excluding_tax, tax = sum of total_taxes[].amount, fallback total - net).
 * A single synthetic line carries the applied rate/behavior/reason for the webhook —
 * it is never matched to DB rows. Numbers come from Stripe; all MINOR units.
 */
export function buildTaxSnapshotFromInvoice(invoice: Stripe.Invoice): OrderTaxSnapshot {
  const net = invoice.total_excluding_tax ?? null;
  const taxes = invoice.total_taxes ?? [];
  const taxTotal =
    taxes.length > 0
      ? taxes.reduce((sum, t) => sum + (t.amount ?? 0), 0)
      : net !== null && typeof invoice.total === 'number'
        ? invoice.total - net
        : null;

  // Single applied component → effective rate. Derive from the TRUE net (total_excluding_tax),
  // NOT taxable_amount: for inclusive (brutto) tax Stripe sets taxable_amount to the GROSS, so
  // amount/taxable_amount would understate the rate (e.g. 18.7% instead of 23%).
  const single = taxes.length === 1 ? taxes[0] : null;
  const vatRate =
    single && net !== null && net > 0
      ? Math.round((single.amount / net) * 10000) / 100
      : null;
  const taxBehavior: LineTaxSnapshot['taxBehavior'] = single
    ? single.tax_behavior === 'inclusive'
      ? 'inclusive'
      : 'exclusive'
    : null;
  const taxabilityReason = single?.taxability_reason ?? null;

  let status: TaxSnapshotStatus;
  if (net === null || taxTotal === null) status = 'unavailable';
  else if (taxTotal === 0) status = 'none';
  else status = 'captured';

  return {
    netTotal: net,
    taxTotal,
    currency: invoice.currency ?? 'usd',
    status,
    stripeTaxApplied: invoice.automatic_tax?.enabled ?? false,
    // Order-level only (subscriptions have no payment_line_items). The single synthetic
    // line is informational for the invoice.paid webhook; never matched to DB rows.
    lines:
      net !== null && taxTotal !== null
        ? [
            {
              productId: null,
              isBump: false,
              netAmount: net,
              taxAmount: taxTotal,
              grossAmount: net + taxTotal,
              vatRate,
              taxBehavior,
              taxabilityReason,
              breakdown: [],
            },
          ]
        : [],
  };
}

/**
 * Capture a paid subscription Invoice's tax and persist ORDER-LEVEL totals onto the
 * subscription's payment_transactions row (net_total / tax_total / tax_snapshot_status).
 * FAIL-SAFE: never throws — a snapshot error must not break subscription billing. Returns
 * the snapshot (for the invoice.paid webhook payload). No per-line rows are written
 * (subscriptions don't have payment_line_items).
 */
export async function captureAndPersistInvoiceTax(params: {
  supabase: SupabaseClient<Database>;
  invoice: Stripe.Invoice;
  transactionId: string | null | undefined;
}): Promise<OrderTaxSnapshot | undefined> {
  const { supabase, invoice, transactionId } = params;
  if (!transactionId) return undefined;
  try {
    const snapshot = buildTaxSnapshotFromInvoice(invoice);
    await supabase
      .from('payment_transactions')
      .update({
        net_total: snapshot.netTotal,
        tax_total: snapshot.taxTotal,
        tax_snapshot_status: snapshot.status,
      })
      .eq('id', transactionId);
    return snapshot;
  } catch (e) {
    console.error('[tax-snapshot] invoice capture failed (non-fatal):', e instanceof Error ? e.message : e);
    try {
      await supabase
        .from('payment_transactions')
        .update({ tax_snapshot_status: 'unavailable' })
        .eq('id', transactionId);
    } catch {
      /* swallow — never throw out of the billing path */
    }
    return undefined;
  }
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
 * payment_transactions totals + status.
 *
 * Per-line `vat_exempt` is the product's vat_exempt snapshot ONLY in local tax mode.
 * When Stripe Tax computed the order (`snapshot.stripeTaxApplied`), Stripe is the sole
 * authority on taxability, so vat_exempt is forced false and the truth lives in
 * `taxability_reason` + `tax_amount` — a PL "zw." flag must not claim exemption where
 * Stripe legitimately charged VAT (e.g. cross-border OSS).
 */
export async function persistTaxSnapshot(
  supabase: SupabaseClient<Database>,
  transactionId: string,
  snapshot: OrderTaxSnapshot,
): Promise<{ matched: number; status: TaxSnapshotStatus }> {
  const { data: rows } = await supabase
    .from('payment_line_items')
    .select('id, product_id, item_type')
    .eq('transaction_id', transactionId)
    // Deterministic order so the POSITIONAL fallback in matchSnapshotLinesToRows (used only
    // when Stripe lines lack product_id) is stable rather than DB-arbitrary: insert order =
    // main first, then bumps, matching how the Stripe line items are built.
    .order('created_at', { ascending: true })
    .order('item_type', { ascending: true });

  const { pairs, complete } = matchSnapshotLinesToRows(snapshot.lines, (rows ?? []) as LineRow[]);

  let matched = 0;
  if (complete) {
    // Local mode only: the seller's per-product vat_exempt is the label authority.
    // In Stripe Tax mode we never read it (empty map → vat_exempt false for every line).
    const exemptById = new Map<string, boolean>();
    if (!snapshot.stripeTaxApplied) {
      const productIds = [
        ...new Set(pairs.map((p) => p.row.product_id).filter((id): id is string => !!id)),
      ];
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, vat_exempt')
          .in('id', productIds);
        for (const p of products ?? []) exemptById.set(p.id, p.vat_exempt ?? false);
      }
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
